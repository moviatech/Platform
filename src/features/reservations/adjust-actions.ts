"use server";

import { confirmLicenseKind, syncInsuranceState } from "@/features/drivers/service";
import { licenseKinds, protectionAllowed } from "@/features/drivers/types";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { requirePermission } from "@/lib/auth/staff";
import { requireScope } from "@/lib/auth/scope";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ReservationActionState } from "./actions";
import { reservationStatuses, undoWindowMs } from "./types";

const revertInput = z.object({ reservationId: z.uuid() });

export async function revertReservationStatus(_: ReservationActionState, form: FormData): Promise<ReservationActionState> {
  const session = await requirePermission("reservation.edit");
  const parsed = revertInput.safeParse({ reservationId: form.get("reservationId") });
  if (!parsed.success) return { error: "invalid" };
  const { reservationId } = parsed.data;
  await requireScope(session, { reservation: reservationId });

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
  await syncInsuranceState(reservationId);

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

const kindInput = z.object({ reservationId: z.uuid(), kind: z.enum(licenseKinds) });

export async function setLicenseKind(reservationId: string, kind: string): Promise<ReservationActionState> {
  const session = await requirePermission("reservation.edit");
  const parsed = kindInput.safeParse({ reservationId, kind });
  if (!parsed.success) return { error: "invalid" };
  await requireScope(session, { reservation: parsed.data.reservationId });
  const { data: holder } = await createAdminClient().from("reservations").select("customer_id, number").eq("id", parsed.data.reservationId).maybeSingle();
  if (!holder?.customer_id || !(await confirmLicenseKind(holder.customer_id, parsed.data.kind))) return { error: "failed" };
  await audit({ actorUserId: session.userId, actorType: "STAFF", action: "customer.license_kind_set", entityType: "customer", entityId: holder.customer_id, metadata: { by: session.displayName, kind: parsed.data.kind, reservationId: parsed.data.reservationId, number: holder.number } });
  revalidatePath(`/ops/reservations/${parsed.data.reservationId}`);
  return { ok: true };
}

const readinessInput = z.object({
  reservationId: z.uuid(),
  field: z.enum(["verification", "agreement", "insurance"]),
  value: z.enum(["PENDING", "VERIFIED", "SIGNED", "UPLOADED"]),
});

export async function setReadiness(_: ReservationActionState, form: FormData): Promise<ReservationActionState> {
  const session = await requirePermission("reservation.edit");
  const parsed = readinessInput.safeParse({ reservationId: form.get("reservationId"), field: form.get("field"), value: form.get("value") });
  if (!parsed.success) return { error: "invalid" };
  const { reservationId, field, value } = parsed.data;
  await requireScope(session, { reservation: reservationId });
  const allowed = field === "verification" ? ["PENDING", "VERIFIED"] : field === "insurance" ? ["UPLOADED", "VERIFIED"] : ["PENDING", "SIGNED"];
  if (!allowed.includes(value)) return { error: "invalid" };

  if (field === "insurance") {
    const supabase = createAdminClient();
    const { data: current } = await supabase.from("reservations").select("insurance_state, insurance_proof_path, protection, customer:customers(license_kind)").eq("id", reservationId).maybeSingle();
    if (!current?.insurance_proof_path || !["UPLOADED", "VERIFIED"].includes(current.insurance_state)) return { error: "invalid" };
    if (!protectionAllowed(current.protection, (current.customer as unknown as { license_kind: string | null } | null)?.license_kind)) return { error: "protection_required" };
    const verified = value === "VERIFIED";
    const { error } = await supabase
      .from("reservations")
      .update({ insurance_state: value, insurance_verified_by: verified ? session.userId : null, insurance_verified_at: verified ? new Date().toISOString() : null })
      .eq("id", reservationId);
    if (error) return { error: "failed" };
    await audit({ actorUserId: session.userId, actorType: "STAFF", action: verified ? "reservation.insurance_verified" : "reservation.insurance_unverified", entityType: "reservation", entityId: reservationId, metadata: { by: session.displayName, proof: current.insurance_proof_path } });
    revalidatePath(`/ops/reservations/${reservationId}`);
    return { ok: true };
  }

  if (field === "verification" && value === "VERIFIED") {
    const kind = z.enum(licenseKinds).safeParse(form.get("licenseKind"));
    if (!kind.success) return { error: "license_kind_required" };
    const { data: holder } = await createAdminClient().from("reservations").select("customer_id").eq("id", reservationId).maybeSingle();
    if (!holder?.customer_id || !(await confirmLicenseKind(holder.customer_id, kind.data))) return { error: "failed" };
  }

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
