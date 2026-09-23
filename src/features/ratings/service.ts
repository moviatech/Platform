import "server-only";
import { randomBytes } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { lowScoreMax, type Rating, type RatingKind, type RatingSource, type Touchpoint } from "./types";

const nil = "00000000-0000-0000-0000-000000000000";

export type RatingInput = {
  kind: RatingKind;
  score: number;
  comment?: string | null;
  customerId?: string | null;
  reservationId?: string | null;
  conversationId?: string | null;
  staffUserId?: string | null;
  source: RatingSource;
};

export function normalizeScore(value: unknown) {
  const score = Number(value);
  return Number.isInteger(score) && score >= 1 && score <= 5 ? score : null;
}

export function normalizeComment(value: unknown, score: number) {
  const text = typeof value === "string" ? value.trim().slice(0, 2000) : "";
  return text || (score <= lowScoreMax ? null : null);
}

export async function saveRating(input: RatingInput): Promise<Rating | null> {
  const supabase = createAdminClient();
  let query = supabase.from("ratings").select("id");
  if (input.conversationId) query = query.eq("conversation_id", input.conversationId);
  else if (input.reservationId) query = query.eq("reservation_id", input.reservationId).eq("kind", input.kind).eq("staff_user_id", input.staffUserId ?? nil);
  else return null;
  const { data: existing } = input.conversationId || input.staffUserId ? await query.maybeSingle() : await supabase.from("ratings").select("id").eq("reservation_id", input.reservationId!).eq("kind", input.kind).is("staff_user_id", null).maybeSingle();
  const row = {
    kind: input.kind,
    score: input.score,
    comment: input.comment ?? null,
    customer_id: input.customerId ?? null,
    reservation_id: input.reservationId ?? null,
    conversation_id: input.conversationId ?? null,
    staff_user_id: input.staffUserId ?? null,
    source: input.source,
  };
  const result = existing ? await supabase.from("ratings").update(row).eq("id", existing.id).select("*").single() : await supabase.from("ratings").insert(row).select("*").single();
  return (result.data as Rating | null) ?? null;
}

export async function getConversationRating(conversationId: string): Promise<Rating | null> {
  const { data } = await createAdminClient().from("ratings").select("*").eq("conversation_id", conversationId).maybeSingle();
  return (data as Rating | null) ?? null;
}

export async function lastStaffResponder(conversationId: string): Promise<{ userId: string; displayName: string } | null> {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("messages")
    .select("sent_by, staff:staff_members!messages_sent_by_fkey(display_name)")
    .eq("conversation_id", conversationId)
    .eq("direction", "OUTBOUND")
    .not("sent_by", "is", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data?.sent_by) return null;
  const staff = Array.isArray(data.staff) ? data.staff[0] : data.staff;
  return { userId: data.sent_by as string, displayName: (staff as { display_name?: string } | null)?.display_name ?? "Movia" };
}

export async function ensureTripSurvey(reservationId: string) {
  const supabase = createAdminClient();
  const { data: existing } = await supabase.from("trip_surveys").select("id, token, sent_at, completed_at").eq("reservation_id", reservationId).maybeSingle();
  if (existing) return existing;
  const { data: reservation } = await supabase.from("reservations").select("customer_id").eq("id", reservationId).maybeSingle();
  const token = randomBytes(24).toString("base64url");
  const { data: created } = await supabase.from("trip_surveys").insert({ reservation_id: reservationId, customer_id: reservation?.customer_id ?? null, token }).select("id, token, sent_at, completed_at").single();
  return created;
}

export async function listTouchpoints(reservationId: string): Promise<Touchpoint[]> {
  const supabase = createAdminClient();
  const [{ data: inspections }, { data: conversations }, { data: ratings }] = await Promise.all([
    supabase.from("inspections").select("kind, performed_by, staff:staff_members!inspections_performed_by_fkey(display_name)").eq("reservation_id", reservationId),
    supabase.from("conversations").select("id").eq("reservation_id", reservationId),
    supabase.from("ratings").select("*").eq("reservation_id", reservationId),
  ]);
  const rated = (ratings ?? []) as Rating[];
  const find = (kind: RatingKind, staffUserId: string | null) => rated.find((item) => item.kind === kind && (item.staff_user_id ?? null) === staffUserId) ?? null;
  const points: Touchpoint[] = [];
  const staffName = (value: unknown) => {
    const row = Array.isArray(value) ? value[0] : value;
    return (row as { display_name?: string } | null)?.display_name ?? null;
  };
  const conversationIds = (conversations ?? []).map((item) => item.id as string);
  if (conversationIds.length) {
    const { data: senders } = await supabase
      .from("messages")
      .select("sent_by, staff:staff_members!messages_sent_by_fkey(display_name)")
      .in("conversation_id", conversationIds)
      .eq("direction", "OUTBOUND")
      .not("sent_by", "is", null);
    const seen = new Set<string>();
    for (const sender of senders ?? []) {
      const id = sender.sent_by as string;
      if (seen.has(id)) continue;
      seen.add(id);
      points.push({ key: `conversation:${id}`, kind: "CONVERSATION", staffUserId: id, staffName: staffName(sender.staff), rated: find("CONVERSATION", id) });
    }
  }
  for (const kind of ["PICKUP", "RETURN"] as const) {
    const inspection = (inspections ?? []).find((item) => item.kind === kind);
    if (!inspection) continue;
    const staffUserId = (inspection.performed_by as string | null) ?? null;
    points.push({ key: kind.toLowerCase(), kind, staffUserId, staffName: staffName(inspection.staff), rated: find(kind, staffUserId) });
  }
  points.push({ key: "vehicle", kind: "VEHICLE", staffUserId: null, staffName: null, rated: find("VEHICLE", null) });
  return points;
}
