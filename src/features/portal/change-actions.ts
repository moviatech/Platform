"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { isLocale, localeCookie } from "@/i18n/config";
import { isClockTime, isIsoDate, zonedToUtc } from "@/features/booking/time";
import { audit } from "@/lib/audit";
import { getCustomerSession } from "@/lib/auth/customer";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatFullDateTime } from "@/lib/utils/format";
import { attachToMessage, parseAttachments } from "./attachments";
import { requestSubjects, requestTypes, type RequestState } from "./request-types";

const input = z.object({
  number: z.string().regex(/^MV-[A-Z0-9]{6}$/),
  kind: z.enum(requestTypes),
  pickupDate: z.string().optional(),
  pickupTime: z.string().optional(),
  returnDate: z.string().optional(),
  returnTime: z.string().optional(),
  driverName: z.string().trim().max(120).optional(),
  notes: z.string().trim().max(3000).optional(),
});

const dated = ["schedule", "extend"];
const preview = (text: string) => text.replace(/\s+/g, " ").slice(0, 140);

export async function submitChangeRequest(_: RequestState, form: FormData): Promise<RequestState> {
  const session = await getCustomerSession();
  if (!session) redirect("/login");
  const parsed = input.safeParse({
    number: form.get("number"),
    kind: form.get("kind"),
    pickupDate: form.get("pickupDate") ?? undefined,
    pickupTime: form.get("pickupTime") ?? undefined,
    returnDate: form.get("returnDate") ?? undefined,
    returnTime: form.get("returnTime") ?? undefined,
    driverName: form.get("driverName") ?? undefined,
    notes: form.get("notes") ?? undefined,
  });
  if (!parsed.success) return { error: "invalid" };
  const { number, kind, notes } = parsed.data;
  const attachments = parseAttachments(form.get("attachments"), session.customerId);
  if (!attachments) return { error: "invalid" };

  const supabase = createAdminClient();
  const { data: reservation } = await supabase
    .from("reservations")
    .select("id, number, status, pickup_at, return_at, customer_id, vehicle_class:vehicle_classes(name, name_zh)")
    .eq("number", number)
    .eq("customer_id", session.customerId)
    .maybeSingle();
  if (!reservation) return { error: "not_found" };
  if (!["REQUESTED", "PENDING_PAYMENT", "CONFIRMED", "ACTIVE"].includes(reservation.status)) return { error: "reservation_closed" };
  if (reservation.status === "ACTIVE" && kind === "schedule") return { error: "reservation_closed" };

  const stored = (await cookies()).get(localeCookie)?.value;
  const locale = isLocale(stored) ? stored : session.language;
  const zh = locale === "zh";
  const payload: Record<string, string> = {};
  if (dated.includes(kind)) {
    const { pickupDate, pickupTime, returnDate, returnTime } = parsed.data;
    if (!isIsoDate(pickupDate) || !isClockTime(pickupTime) || !isIsoDate(returnDate) || !isClockTime(returnTime)) return { error: "invalid_dates" };
    const pickupAt = zonedToUtc(pickupDate, pickupTime, "America/Los_Angeles");
    const returnAt = zonedToUtc(returnDate, returnTime, "America/Los_Angeles");
    if (returnAt <= pickupAt) return { error: "invalid_dates" };
    payload.pickupAt = kind === "extend" ? reservation.pickup_at : pickupAt.toISOString();
    payload.returnAt = returnAt.toISOString();
    if (kind === "extend" && returnAt <= new Date(reservation.return_at)) return { error: "invalid_dates" };
  }
  if (parsed.data.driverName) payload.driverName = parsed.data.driverName;
  if (notes) payload.notes = notes;
  if (!dated.includes(kind) && !notes && !parsed.data.driverName) return { error: "invalid" };

  const lines: string[] = [];
  if (payload.pickupAt && payload.returnAt) {
    lines.push(`${zh ? "现在" : "Current"}: ${formatFullDateTime(reservation.pickup_at, locale)} → ${formatFullDateTime(reservation.return_at, locale)}`);
    lines.push(`${zh ? "希望改为" : "Requested"}: ${formatFullDateTime(payload.pickupAt, locale)} → ${formatFullDateTime(payload.returnAt, locale)}`);
  }
  if (payload.driverName) lines.push(`${zh ? "驾驶人" : "Driver"}: ${payload.driverName}`);
  if (notes) lines.push(notes);
  const body = lines.join("\n");
  const subjectBase = requestSubjects[kind][locale];
  const cls = reservation.vehicle_class as unknown as { name: string; name_zh: string | null } | null;
  const vehicle = zh ? (cls?.name_zh ?? cls?.name) : cls?.name;

  const { data: existing } = await supabase.from("conversations").select("id").eq("reservation_id", reservation.id).limit(1);
  let conversationId = existing?.[0]?.id as string | undefined;
  const now = new Date().toISOString();
  if (conversationId) {
    await supabase.from("conversations").update({ status: "OPEN", unread: true, last_message_at: now, last_message_preview: preview(`${subjectBase} · ${body}`), last_direction: "INBOUND" }).eq("id", conversationId);
  } else {
    const { data: created } = await supabase
      .from("conversations")
      .insert({
        mailbox: "contact",
        subject: `${reservation.number} · ${vehicle ?? ""}`,
        customer_email: session.email,
        customer_name: session.fullName,
        customer_id: session.customerId,
        reservation_id: reservation.id,
        locale,
        status: "OPEN",
        unread: true,
        last_message_at: now,
        last_message_preview: preview(`${subjectBase} · ${body}`),
        last_direction: "INBOUND",
      })
      .select("id")
      .single();
    conversationId = created?.id;
  }
  if (!conversationId) return { error: "failed" };

  const { data: inserted } = await supabase
    .from("messages")
    .insert({
      conversation_id: conversationId,
      direction: "INBOUND",
      channel: "WEB_FORM",
      from_email: session.email,
      from_name: session.fullName,
      subject: `${subjectBase} · ${reservation.number}`,
      body_text: `[${subjectBase}]\n${body}`,
      delivery_status: "RECEIVED",
    })
    .select("id")
    .single();
  if (inserted) await attachToMessage(inserted.id, attachments);
  const { data: request, error } = await supabase
    .from("change_requests")
    .insert({ reservation_id: reservation.id, customer_id: session.customerId, conversation_id: conversationId, kind, payload })
    .select("id")
    .single();
  if (error || !request) return { error: "failed" };
  await audit({ actorUserId: session.userId, actorType: "CUSTOMER", action: "reservation.change_requested", entityType: "reservation", entityId: reservation.id, metadata: { requestId: request.id, kind, payload, by: session.fullName, number: reservation.number } });
  revalidatePath("/account", "layout");
  redirect(`/messages/${conversationId}`);
}
