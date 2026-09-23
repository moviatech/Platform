"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { approvalThresholdCents, requestApproval } from "@/features/finance/approvals";
import { audit } from "@/lib/audit";
import { requirePermission } from "@/lib/auth/staff";
import { requireScope } from "@/lib/auth/scope";
import { createAdminClient } from "@/lib/supabase/admin";
import { chargeClaim, createDamageClaim, type ClaimRow } from "./service";

export type ClaimState = { ok?: boolean; error?: string; pending?: boolean };

const statusInput = z.object({ claimId: z.uuid(), status: z.enum(["INSURANCE", "CLOSED"]), note: z.string().trim().max(500) });

export async function updateClaimStatus(form: FormData) {
  const session = await requirePermission("reservation.edit");
  const parsed = statusInput.safeParse({ claimId: form.get("claimId"), status: form.get("status"), note: form.get("note") ?? "" });
  if (!parsed.success) return;
  const supabase = createAdminClient();
  const { data: claim } = await supabase.from("damage_claims").select("id, reservation_id, status").eq("id", parsed.data.claimId).maybeSingle();
  if (!claim || claim.status === "CHARGED") return;
  await requireScope(session, { reservation: claim.reservation_id });
  await supabase.from("damage_claims").update({ status: parsed.data.status, staff_note: parsed.data.note || null, decided_by: session.userId, updated_at: new Date().toISOString() }).eq("id", claim.id).neq("status", "CHARGED");
  await audit({ actorUserId: session.userId, actorType: "STAFF", action: "damage_claim.status_changed", entityType: "reservation", entityId: claim.reservation_id, metadata: { by: session.displayName, claimId: claim.id, status: parsed.data.status, note: parsed.data.note || undefined } });
  revalidatePath(`/ops/reservations/${claim.reservation_id}`);
  revalidatePath("/ops", "layout");
}

const addInput = z.object({
  reservationId: z.uuid(),
  amount: z
    .string()
    .trim()
    .regex(/^\d{1,6}(\.\d{1,2})?$/)
    .transform((value) => Math.round(Number(value) * 100)),
  description: z.string().trim().min(3).max(2000),
});

export async function addDamageClaim(_: ClaimState, form: FormData): Promise<ClaimState> {
  const session = await requirePermission("vehicle.inspect");
  const parsed = addInput.safeParse({ reservationId: form.get("reservationId"), amount: form.get("damageAmount") ?? "", description: form.get("damageDescription") ?? "" });
  if (!parsed.success || parsed.data.amount <= 0) return { error: "invalid" };
  const { reservationId, amount, description } = parsed.data;
  await requireScope(session, { reservation: reservationId });
  const supabase = createAdminClient();
  const { data: reservation } = await supabase.from("reservations").select("status, customer_id").eq("id", reservationId).maybeSingle();
  if (!reservation?.customer_id || reservation.status !== "COMPLETED") return { error: "not_found" };
  const { count: repeated } = await supabase.from("damage_claims").select("id", { count: "exact", head: true }).eq("reservation_id", reservationId).eq("amount_cents", amount).eq("description", description).gte("created_at", new Date(Date.now() - 120000).toISOString());
  if (repeated) return { ok: true };
  const { data: inspection } = await supabase.from("inspections").select("id").eq("reservation_id", reservationId).eq("kind", "RETURN").maybeSingle();
  const claim = await createDamageClaim({ reservationId, inspectionId: (inspection?.id as string | undefined) ?? null, customerId: reservation.customer_id, amountCents: amount, description, createdBy: session.userId, createdByName: session.displayName });
  if (!claim) return { error: "failed" };
  revalidatePath(`/ops/reservations/${reservationId}`);
  revalidatePath("/ops", "layout");
  return { ok: true };
}

export async function chargeDamageClaim(_: ClaimState, form: FormData): Promise<ClaimState> {
  const session = await requirePermission("payment.capture");
  const parsed = z.uuid().safeParse(form.get("claimId"));
  if (!parsed.success) return { error: "invalid" };
  const supabase = createAdminClient();
  const { data } = await supabase.from("damage_claims").select("id, reservation_id, inspection_id, customer_id, amount_cents, description, status, consent_at, consent_text, dispute_note, payment_id, staff_note, created_at").eq("id", parsed.data).maybeSingle();
  const claim = data as ClaimRow | null;
  if (!claim) return { error: "not_found" };
  await requireScope(session, { reservation: claim.reservation_id });
  if (claim.status !== "CONSENTED") return { error: "consent_required" };
  if (claim.amount_cents > approvalThresholdCents && !session.permissions.has("finance.approve")) {
    const { count } = await supabase.from("approvals").select("id", { count: "exact", head: true }).eq("kind", "CHARGE").eq("status", "PENDING").eq("reservation_id", claim.reservation_id).eq("payload->>claimId", claim.id);
    if (count) return { ok: true, pending: true };
    await requestApproval({ kind: "CHARGE", reservationId: claim.reservation_id, amountCents: claim.amount_cents, reason: `Damage claim ${claim.id}`, payload: { intent: "charge", kind: "ADDITIONAL", claimId: claim.id }, requestedBy: session.userId, requesterName: session.displayName });
    revalidatePath(`/ops/reservations/${claim.reservation_id}`);
    return { ok: true, pending: true };
  }
  const result = await chargeClaim(claim, { userId: session.userId, displayName: session.displayName, type: "STAFF" });
  revalidatePath(`/ops/reservations/${claim.reservation_id}`);
  revalidatePath("/ops", "layout");
  return result.ok ? { ok: true } : { error: result.error };
}
