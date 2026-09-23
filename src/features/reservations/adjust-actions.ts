"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { requirePermission } from "@/lib/auth/staff";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ReservationActionState } from "./actions";
import { reservationStatuses, undoWindowMs } from "./types";

const revertInput = z.object({ reservationId: z.uuid() });

export async function revertReservationStatus(_: ReservationActionState, form: FormData): Promise<ReservationActionState> {
  const session = await requirePermission("reservation.edit");
  const parsed = revertInput.safeParse({ reservationId: form.get("reservationId") });
  if (!parsed.success) return { error: "invalid" };
  const { reservationId } = parsed.data;

  const supabase = createAdminClient();
  const { data: last } = await supabase
    .from("audit_events")
    .select("action, metadata, created_at, actor_user_id")
    .eq("entity_type", "reservation")
    .eq("entity_id", reservationId)
    .in("action", ["reservation.status_changed", "reservation.status_reverted"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const metadata = (last?.metadata ?? {}) as Record<string, unknown>;
  const previous = last?.action === "reservation.status_changed" && last.actor_user_id ? metadata.from : null;
  if (typeof previous !== "string" || !(reservationStatuses as readonly string[]).includes(previous)) return { error: "nothing_to_undo" };
  if (!last || Date.now() - new Date(last.created_at).getTime() > undoWindowMs) return { error: "undo_expired" };

  const { data: current } = await supabase.from("reservations").select("status, number").eq("id", reservationId).maybeSingle();
  if (!current || current.status !== metadata.to) return { error: "nothing_to_undo" };
  if (current.status === "ACTIVE" || current.status === "COMPLETED") return { error: "invalid_revert" };

  const { error } = await supabase.rpc("revert_reservation_status", { p_reservation_id: reservationId, p_previous: previous });
  if (error) {
    const code = ["no_vehicle_available", "invalid_revert"].find((item) => error.message.includes(item));
    return { error: code ?? (error.code === "23P01" ? "vehicle_not_available" : "failed") };
  }

  await audit({
    actorUserId: session.userId,
    actorType: "STAFF",
    action: "reservation.status_reverted",
    entityType: "reservation",
    entityId: reservationId,
    metadata: { by: session.displayName, number: current.number, from: current.status, to: previous },
  });
  revalidatePath("/ops", "layout");
  return { ok: true };
}

const readinessInput = z.object({
  reservationId: z.uuid(),
  field: z.enum(["verification", "agreement"]),
  value: z.enum(["PENDING", "VERIFIED", "SIGNED"]),
});

export async function setReadiness(_: ReservationActionState, form: FormData): Promise<ReservationActionState> {
  const session = await requirePermission("reservation.edit");
  const parsed = readinessInput.safeParse({ reservationId: form.get("reservationId"), field: form.get("field"), value: form.get("value") });
  if (!parsed.success) return { error: "invalid" };
  const { reservationId, field, value } = parsed.data;
  const allowed = field === "verification" ? ["PENDING", "VERIFIED"] : ["PENDING", "SIGNED"];
  if (!allowed.includes(value)) return { error: "invalid" };

  const column = field === "verification" ? "verification_state" : "agreement_state";
  const { error } = await createAdminClient()
    .from("reservations")
    .update({ [column]: value })
    .eq("id", reservationId);
  if (error) return { error: "failed" };

  await audit({
    actorUserId: session.userId,
    actorType: "STAFF",
    action: field === "verification" ? "reservation.verification_marked" : "reservation.agreement_marked",
    entityType: "reservation",
    entityId: reservationId,
    metadata: { by: session.displayName, value },
  });
  revalidatePath(`/ops/reservations/${reservationId}`);
  return { ok: true };
}
