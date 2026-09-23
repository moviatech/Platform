"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { zonedParts } from "@/features/booking/time";
import { audit } from "@/lib/audit";
import { requirePermission } from "@/lib/auth/staff";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatMoney } from "@/lib/utils/format";
import { getAllocation, getContribution } from "./contributions";
import { getEntry, LedgerError, postEntries } from "./ledger";
import { notifyInvestorEvent } from "./notify";

export type FinanceState = { ok?: boolean; error?: "invalid" | "status" | "failed" | "insufficient" | "vehicle_taken" | "memo" };

const uuid = z.uuid();
const trimmed = (value: FormDataEntryValue | null) => String(value ?? "").trim();
const dollars = (value: FormDataEntryValue | null) => Number(trimmed(value).replace(/[,$\s]/g, ""));
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const today = () => zonedParts(new Date(), "America/Los_Angeles").date;

function refresh(investorId: string, vehicleId?: string | null) {
  revalidatePath("/ops/investors");
  revalidatePath(`/ops/investors/${investorId}`);
  if (vehicleId) revalidatePath(`/ops/fleet/${vehicleId}`);
}

const vehicleLabel = (vehicle: { fleet_number: string; vehicle_class: { name: string } | null } | null) => (vehicle ? `${vehicle.vehicle_class?.name ?? ""} ${vehicle.fleet_number}`.trim() : "");

export async function confirmCapital(_: FinanceState, form: FormData): Promise<FinanceState> {
  const session = await requirePermission("investor.finance");
  const parsed = z.object({ id: uuid, received: z.number().positive().max(10_000_000), reference: z.string().trim().min(1).max(120) }).safeParse({ id: form.get("id"), received: dollars(form.get("received")), reference: trimmed(form.get("reference")) });
  if (!parsed.success) return { error: "invalid" };
  const contribution = await getContribution(parsed.data.id);
  if (!contribution || contribution.kind !== "CAPITAL" || contribution.status !== "REQUESTED") return { error: "status" };
  const receivedCents = Math.round(parsed.data.received * 100);
  const admin = createAdminClient();
  const { data: updated } = await admin
    .from("investor_contributions")
    .update({ status: "CONFIRMED", received_cents: receivedCents, bank_reference: parsed.data.reference, decided_by: session.userId, decided_at: new Date().toISOString() })
    .eq("id", contribution.id)
    .eq("status", "REQUESTED")
    .select("id");
  if (!updated?.length) return { error: "status" };
  try {
    await postEntries(contribution.investor_id, [{ type: "CAPITAL_IN", bucket: "AVAILABLE", amountCents: receivedCents, contributionId: contribution.id, memo: parsed.data.reference, createdBy: session.userId }]);
  } catch {
    await admin.from("investor_contributions").update({ status: "REQUESTED", received_cents: null, bank_reference: null, decided_by: null, decided_at: null }).eq("id", contribution.id);
    return { error: "failed" };
  }
  await audit({ actorUserId: session.userId, actorType: "STAFF", action: "investor.capital_confirmed", entityType: "investor_contribution", entityId: contribution.id, metadata: { by: session.displayName, receivedCents, reference: parsed.data.reference } });
  await notifyInvestorEvent(contribution.investor_id, "capital_received", { amount: formatMoney(receivedCents) }, "/funds", { dedupeKey: `capital_received:${contribution.id}` });
  refresh(contribution.investor_id);
  return { ok: true };
}

export async function declineContribution(_: FinanceState, form: FormData): Promise<FinanceState> {
  const session = await requirePermission("investor.manage");
  const parsed = z.object({ id: uuid, note: z.string().trim().max(1000).optional() }).safeParse({ id: form.get("id"), note: trimmed(form.get("note")) });
  if (!parsed.success) return { error: "invalid" };
  const contribution = await getContribution(parsed.data.id);
  if (!contribution || contribution.status !== "REQUESTED") return { error: "status" };
  const { data: updated } = await createAdminClient()
    .from("investor_contributions")
    .update({ status: "DECLINED", decision_note: parsed.data.note || null, decided_by: session.userId, decided_at: new Date().toISOString() })
    .eq("id", contribution.id)
    .eq("status", "REQUESTED")
    .select("id");
  if (!updated?.length) return { error: "status" };
  await audit({ actorUserId: session.userId, actorType: "STAFF", action: "investor.contribution_declined", entityType: "investor_contribution", entityId: contribution.id, metadata: { by: session.displayName, note: parsed.data.note || null } });
  await notifyInvestorEvent(contribution.investor_id, "contribution_declined", { note: parsed.data.note ?? "" }, "/invest", { dedupeKey: `contribution_declined:${contribution.id}` });
  refresh(contribution.investor_id);
  return { ok: true };
}

const allocationInput = z.object({ investorId: uuid, vehicleId: uuid, revenueShareBps: z.number().int().min(0).max(10000), effectiveFrom: isoDate, contributionId: uuid.optional() });

async function insertAllocation(input: { investorId: string; vehicleId: string; contributionId: string | null; source: "CAPITAL" | "VEHICLE"; revenueShareBps: number; costBasisCents: number; effectiveFrom: string; createdBy: string }) {
  const { data, error } = await createAdminClient()
    .from("investor_allocations")
    .insert({
      investor_id: input.investorId,
      vehicle_id: input.vehicleId,
      contribution_id: input.contributionId,
      source: input.source,
      share_bps: 10000,
      revenue_share_bps: input.revenueShareBps,
      cost_basis_cents: input.costBasisCents,
      effective_from: input.effectiveFrom,
      status: "ACTIVE",
      created_by: input.createdBy,
    })
    .select("id")
    .single();
  if (error) return { error: /investor_allocations_vehicle_active_idx/.test(error.message) ? ("vehicle_taken" as const) : ("failed" as const) };
  return { id: data.id };
}

export async function confirmVehicle(_: FinanceState, form: FormData): Promise<FinanceState> {
  const session = await requirePermission("investor.manage");
  const parsed = allocationInput.extend({ contributionId: uuid }).safeParse({ investorId: form.get("investorId"), vehicleId: form.get("vehicleId"), revenueShareBps: Math.round(Number(trimmed(form.get("revenueShare"))) * 100), effectiveFrom: trimmed(form.get("effectiveFrom")) || today(), contributionId: form.get("contributionId") });
  if (!parsed.success) return { error: "invalid" };
  const contribution = await getContribution(parsed.data.contributionId);
  if (!contribution || contribution.kind !== "VEHICLE" || contribution.status !== "REQUESTED" || contribution.investor_id !== parsed.data.investorId) return { error: "status" };
  const created = await insertAllocation({ investorId: contribution.investor_id, vehicleId: parsed.data.vehicleId, contributionId: contribution.id, source: "VEHICLE", revenueShareBps: parsed.data.revenueShareBps, costBasisCents: 0, effectiveFrom: parsed.data.effectiveFrom, createdBy: session.userId });
  if ("error" in created) return { error: created.error };
  await createAdminClient().from("investor_contributions").update({ status: "CONFIRMED", decided_by: session.userId, decided_at: new Date().toISOString() }).eq("id", contribution.id);
  const allocation = await getAllocation(created.id);
  await audit({ actorUserId: session.userId, actorType: "STAFF", action: "investor.vehicle_onboarded", entityType: "investor_allocation", entityId: created.id, metadata: { by: session.displayName, vehicleId: parsed.data.vehicleId, contributionId: contribution.id } });
  await notifyInvestorEvent(contribution.investor_id, "vehicle_onboarded", { vehicle: vehicleLabel(allocation?.vehicle ?? null) }, `/assets/${created.id}`, { dedupeKey: `vehicle_onboarded:${created.id}` });
  refresh(contribution.investor_id, parsed.data.vehicleId);
  return { ok: true };
}

export async function createAllocation(_: FinanceState, form: FormData): Promise<FinanceState> {
  const session = await requirePermission("investor.manage");
  const parsed = allocationInput.extend({ costBasis: z.number().positive().max(10_000_000) }).safeParse({ investorId: form.get("investorId"), vehicleId: form.get("vehicleId"), revenueShareBps: Math.round(Number(trimmed(form.get("revenueShare"))) * 100), effectiveFrom: trimmed(form.get("effectiveFrom")) || today(), costBasis: dollars(form.get("costBasis")), contributionId: trimmed(form.get("contributionId")) || undefined });
  if (!parsed.success) return { error: "invalid" };
  const costBasisCents = Math.round(parsed.data.costBasis * 100);
  const created = await insertAllocation({ investorId: parsed.data.investorId, vehicleId: parsed.data.vehicleId, contributionId: parsed.data.contributionId ?? null, source: "CAPITAL", revenueShareBps: parsed.data.revenueShareBps, costBasisCents, effectiveFrom: parsed.data.effectiveFrom, createdBy: session.userId });
  if ("error" in created) return { error: created.error };
  const allocation = await getAllocation(created.id);
  const label = vehicleLabel(allocation?.vehicle ?? null);
  try {
    await postEntries(parsed.data.investorId, [
      { type: "CAPITAL_ALLOCATED", bucket: "AVAILABLE", amountCents: -costBasisCents, vehicleId: parsed.data.vehicleId, allocationId: created.id, memo: label, createdBy: session.userId },
      { type: "CAPITAL_ALLOCATED", bucket: "INVESTED", amountCents: costBasisCents, vehicleId: parsed.data.vehicleId, allocationId: created.id, memo: label, createdBy: session.userId },
    ]);
  } catch (cause) {
    await createAdminClient().from("investor_allocations").delete().eq("id", created.id);
    return { error: cause instanceof LedgerError && cause.message === "insufficient_available" ? "insufficient" : "failed" };
  }
  await audit({ actorUserId: session.userId, actorType: "STAFF", action: "investor.vehicle_allocated", entityType: "investor_allocation", entityId: created.id, metadata: { by: session.displayName, vehicleId: parsed.data.vehicleId, costBasisCents, revenueShareBps: parsed.data.revenueShareBps } });
  await notifyInvestorEvent(parsed.data.investorId, "vehicle_allocated", { amount: formatMoney(costBasisCents), vehicle: label, date: parsed.data.effectiveFrom }, `/assets/${created.id}`, { dedupeKey: `vehicle_allocated:${created.id}` });
  refresh(parsed.data.investorId, parsed.data.vehicleId);
  return { ok: true };
}

export async function endAllocation(_: FinanceState, form: FormData): Promise<FinanceState> {
  const session = await requirePermission("investor.finance");
  const parsed = z.object({ id: uuid, returned: z.number().min(0).max(10_000_000), note: z.string().trim().min(1).max(1000), effectiveTo: isoDate }).safeParse({ id: form.get("id"), returned: dollars(form.get("returned")), note: trimmed(form.get("note")), effectiveTo: trimmed(form.get("effectiveTo")) || today() });
  if (!parsed.success) return { error: parsed.error.issues.some((issue) => issue.path[0] === "note") ? "memo" : "invalid" };
  const allocation = await getAllocation(parsed.data.id);
  if (!allocation || allocation.status === "ENDED") return { error: "status" };
  const returnedCents = Math.round(parsed.data.returned * 100);
  const admin = createAdminClient();
  const { data: updated } = await admin.from("investor_allocations").update({ status: "ENDED", effective_to: parsed.data.effectiveTo, exit_note: parsed.data.note }).eq("id", allocation.id).neq("status", "ENDED").select("id");
  if (!updated?.length) return { error: "status" };
  const label = vehicleLabel(allocation.vehicle);
  const entries = [] as Parameters<typeof postEntries>[1];
  if (allocation.cost_basis_cents > 0) entries.push({ type: "CAPITAL_RETURN", bucket: "INVESTED", amountCents: -allocation.cost_basis_cents, vehicleId: allocation.vehicle_id, allocationId: allocation.id, memo: parsed.data.note, createdBy: session.userId });
  if (returnedCents > 0) entries.push({ type: "CAPITAL_RETURN", bucket: "AVAILABLE", amountCents: returnedCents, vehicleId: allocation.vehicle_id, allocationId: allocation.id, memo: parsed.data.note, createdBy: session.userId });
  if (entries.length) {
    try {
      await postEntries(allocation.investor_id, entries);
    } catch {
      await admin.from("investor_allocations").update({ status: allocation.status, effective_to: null, exit_note: null }).eq("id", allocation.id);
      return { error: "failed" };
    }
  }
  await admin.from("investor_exit_requests").update({ status: "RESOLVED", resolved_by: session.userId, resolved_at: new Date().toISOString(), resolution_note: parsed.data.note }).eq("allocation_id", allocation.id).in("status", ["REQUESTED", "IN_PROGRESS"]);
  await audit({ actorUserId: session.userId, actorType: "STAFF", action: "investor.allocation_ended", entityType: "investor_allocation", entityId: allocation.id, metadata: { by: session.displayName, returnedCents, costBasisCents: allocation.cost_basis_cents, note: parsed.data.note } });
  await notifyInvestorEvent(allocation.investor_id, "allocation_ended", { vehicle: label, amount: formatMoney(returnedCents) }, "/funds", { dedupeKey: `allocation_ended:${allocation.id}` });
  refresh(allocation.investor_id, allocation.vehicle_id);
  return { ok: true };
}

export async function adjustLedger(_: FinanceState, form: FormData): Promise<FinanceState> {
  const session = await requirePermission("investor.finance");
  const parsed = z
    .object({ investorId: uuid, amount: z.number().refine((value) => value !== 0 && Math.abs(value) <= 10_000_000), bucket: z.enum(["AVAILABLE", "PENDING"]), memo: z.string().trim().min(2).max(1000), vehicleId: uuid.optional() })
    .safeParse({ investorId: form.get("investorId"), amount: dollars(form.get("amount")), bucket: form.get("bucket"), memo: trimmed(form.get("memo")), vehicleId: trimmed(form.get("vehicleId")) || undefined });
  if (!parsed.success) return { error: parsed.error.issues.some((issue) => issue.path[0] === "memo") ? "memo" : "invalid" };
  const amountCents = Math.round(parsed.data.amount * 100);
  try {
    const [id] = await postEntries(parsed.data.investorId, [{ type: "ADJUSTMENT", bucket: parsed.data.bucket, amountCents, vehicleId: parsed.data.vehicleId ?? null, memo: parsed.data.memo, createdBy: session.userId, settlesAt: parsed.data.bucket === "PENDING" ? new Date().toISOString() : null }]);
    await audit({ actorUserId: session.userId, actorType: "STAFF", action: "investor.ledger_adjusted", entityType: "investor_ledger_entry", entityId: id, metadata: { by: session.displayName, amountCents, bucket: parsed.data.bucket, memo: parsed.data.memo } });
  } catch (cause) {
    return { error: cause instanceof LedgerError && cause.message === "insufficient_available" ? "insufficient" : "failed" };
  }
  await notifyInvestorEvent(parsed.data.investorId, "ledger_adjusted", { amount: formatMoney(amountCents), memo: parsed.data.memo }, "/funds");
  refresh(parsed.data.investorId);
  return { ok: true };
}

export async function reverseEntry(_: FinanceState, form: FormData): Promise<FinanceState> {
  const session = await requirePermission("investor.finance");
  const parsed = z.object({ id: uuid, memo: z.string().trim().min(2).max(1000) }).safeParse({ id: form.get("id"), memo: trimmed(form.get("memo")) });
  if (!parsed.success) return { error: parsed.error.issues.some((issue) => issue.path[0] === "memo") ? "memo" : "invalid" };
  const entry = await getEntry(parsed.data.id);
  if (!entry || entry.type === "REVERSAL" || entry.bucket === "PAID_OUT") return { error: "status" };
  const { count } = await createAdminClient().from("investor_ledger_entries").select("id", { count: "exact", head: true }).eq("reversal_of", entry.id);
  if (count) return { error: "status" };
  try {
    const [id] = await postEntries(entry.investor_id, [{ type: "REVERSAL", bucket: entry.bucket, amountCents: -entry.amount_cents, reversalOf: entry.id, reservationId: entry.reservation_id, vehicleId: entry.vehicle_id, allocationId: entry.allocation_id, memo: parsed.data.memo, createdBy: session.userId, settlesAt: entry.bucket === "PENDING" ? new Date().toISOString() : null }]);
    await audit({ actorUserId: session.userId, actorType: "STAFF", action: "investor.ledger_reversed", entityType: "investor_ledger_entry", entityId: id, metadata: { by: session.displayName, reversalOf: entry.id, memo: parsed.data.memo } });
  } catch (cause) {
    return { error: cause instanceof LedgerError && cause.message === "insufficient_available" ? "insufficient" : "failed" };
  }
  refresh(entry.investor_id);
  return { ok: true };
}
