import "server-only";
import { zonedParts } from "@/features/booking/time";
import { audit } from "@/lib/audit";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatMoney } from "@/lib/utils/format";
import type { Allocation } from "./contributions";
import { businessDaysAfter, LedgerError, postEntries, type EntryInput, type LedgerEntry } from "./ledger";
import { notifyInvestorEvent } from "./notify";
import { loadInvestorSettings } from "./settings";
import { backfillQuote, coveringAllocation, type AllocationSpan, type DatedLine } from "./share-math";

const zone = "America/Los_Angeles";

export const backfillBatch = 20;

type Completion = { completed_at: string | null; actual_return_at: string | null; return_at: string };

const completionOf = (reservation: Completion) => reservation.completed_at ?? reservation.actual_return_at ?? reservation.return_at;

function chunks<T>(items: T[], size = 50) {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size));
  return result;
}

export async function findAllocationForVehicle(vehicleId: string, onDate: string): Promise<Allocation | null> {
  const { data } = await createAdminClient()
    .from("investor_allocations")
    .select("id, investor_id, vehicle_id, contribution_id, source, compensation, share_bps, revenue_share_bps, cost_basis_cents, effective_from, effective_to, status, exit_note, created_at")
    .eq("vehicle_id", vehicleId)
    .lte("effective_from", onDate)
    .or(`effective_to.is.null,effective_to.gte.${onDate}`)
    .order("effective_from", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as unknown as Allocation | null) ?? null;
}

async function refundsAfterCompletion(completions: Map<string, string>): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  const supabase = createAdminClient();
  for (const ids of chunks([...completions.keys()])) {
    const { data: payments } = await supabase.from("payments").select("id, reservation_id, amount_refunded_cents").in("reservation_id", ids).eq("kind", "RENTAL").gt("amount_refunded_cents", 0);
    const paid = (payments ?? []) as Array<{ id: string; reservation_id: string; amount_refunded_cents: number }>;
    if (!paid.length) continue;
    const { data: refunds } = await supabase.from("refunds").select("payment_id, amount_cents, created_at").in("payment_id", paid.map((payment) => payment.id)).eq("status", "SUCCEEDED");
    for (const payment of paid) {
      const completedAt = Date.parse(completions.get(payment.reservation_id) as string);
      const earlier = (refunds ?? []).filter((refund) => refund.payment_id === payment.id && Date.parse(refund.created_at) < completedAt).reduce((sum, refund) => sum + refund.amount_cents, 0);
      result.set(payment.reservation_id, (result.get(payment.reservation_id) ?? 0) + Math.max(0, payment.amount_refunded_cents - earlier));
    }
  }
  return result;
}

async function sharedReservations(reservationIds: string[], allocationId: string): Promise<Set<string>> {
  const taken = new Set<string>();
  const supabase = createAdminClient();
  for (const ids of chunks(reservationIds)) {
    const { data: shares } = await supabase.from("investor_ledger_entries").select("id, reservation_id, allocation_id").in("reservation_id", ids).eq("type", "RENTAL_SHARE");
    const rows = (shares ?? []) as Array<{ id: string; reservation_id: string; allocation_id: string | null }>;
    if (!rows.length) continue;
    const { data: reversals } = await supabase.from("investor_ledger_entries").select("reversal_of").in("reversal_of", rows.map((row) => row.id));
    const reversed = new Set((reversals ?? []).map((row) => row.reversal_of as string));
    for (const row of rows) if (row.allocation_id === allocationId || !reversed.has(row.id)) taken.add(row.reservation_id);
  }
  return taken;
}

export type ShareResult = { posted: boolean; reason?: string; amountCents?: number; netCents?: number };

export async function postRentalShare(reservationId: string, options: { allocationId?: string; createdBy?: string | null } = {}): Promise<ShareResult> {
  const supabase = createAdminClient();
  const backfill = Boolean(options.allocationId);
  const { data: reservation } = await supabase.from("reservations").select("id, number, status, assigned_vehicle_id, total_cents, completed_at, actual_return_at, return_at").eq("id", reservationId).maybeSingle();
  if (!reservation || reservation.status !== "COMPLETED" || !reservation.assigned_vehicle_id) return { posted: false, reason: "not_completed" };
  const completedAt = completionOf(reservation);
  const onDate = zonedParts(completedAt, zone).date;
  const allocation = await findAllocationForVehicle(reservation.assigned_vehicle_id, onDate);
  if (!allocation) return { posted: false, reason: "no_allocation" };
  if (options.allocationId && allocation.id !== options.allocationId) return { posted: false, reason: "other_allocation" };
  if (allocation.compensation === "PER_MILE") return { posted: false, reason: "per_mile" };
  if ((await sharedReservations([reservationId], allocation.id)).has(reservationId)) return { posted: false, reason: "duplicate" };
  const { data: lines } = await supabase.from("reservation_line_items").select("type, code, amount_cents, created_at").eq("reservation_id", reservationId);
  const refundedCents = backfill ? ((await refundsAfterCompletion(new Map([[reservationId, completedAt]]))).get(reservationId) ?? 0) : 0;
  const { base, shareCents: amountCents, refundCents, cutCents } = backfillQuote({ lines: (lines ?? []) as DatedLine[], completedAt, refundedCents, totalCents: reservation.total_cents ?? 0, revenueShareBps: allocation.revenue_share_bps, shareBps: allocation.share_bps });
  if (amountCents - cutCents <= 0) return { posted: false, reason: "zero" };
  const settings = await loadInvestorSettings();
  const settlesAt = businessDaysAfter(new Date(completedAt), settings.settlementBusinessDays).toISOString();
  const shared = { bucket: "PENDING" as const, settlesAt, reservationId, vehicleId: reservation.assigned_vehicle_id, allocationId: allocation.id, createdBy: options.createdBy ?? null };
  const entries: EntryInput[] = [
    {
      ...shared,
      type: "RENTAL_SHARE",
      amountCents,
      memo: reservation.number,
      metadata: { ...base, totalCents: reservation.total_cents, revenueShareBps: allocation.revenue_share_bps, shareBps: allocation.share_bps, completedAt, ...(backfill ? { backfill: true } : {}) },
    },
  ];
  if (cutCents > 0) entries.push({ ...shared, type: "ADJUSTMENT", amountCents: -cutCents, memo: `Refund ${reservation.number} ${formatMoney(refundCents)}`, metadata: { refundCents, source: "refund", backfill: true } });
  try {
    await postEntries(allocation.investor_id, entries);
  } catch (cause) {
    if (cause instanceof LedgerError && /investor_ledger_rental_share_idx|duplicate/.test(cause.message)) return { posted: false, reason: "duplicate" };
    throw cause;
  }
  await audit({ actorUserId: options.createdBy ?? undefined, actorType: options.createdBy ? "STAFF" : "SYSTEM", action: "investor.share_posted", entityType: "reservation", entityId: reservationId, metadata: { investorId: allocation.investor_id, allocationId: allocation.id, amountCents, ...base, ...(backfill ? { backfill: true, refundCents, cutCents } : {}) } });
  if (!backfill) await notifyInvestorEvent(allocation.investor_id, "share_posted", { amount: formatMoney(amountCents), number: reservation.number }, `/assets/${allocation.id}`, { email: false, dedupeKey: `share_posted:${reservationId}` });
  return { posted: true, amountCents, netCents: amountCents - cutCents };
}

export type BackfillRow = { reservationId: string; number: string; date: string; amountCents: number };

export async function listBackfillRows(allocation: Pick<Allocation, "id" | "vehicle_id" | "compensation" | "share_bps" | "revenue_share_bps">): Promise<BackfillRow[]> {
  if (allocation.compensation !== "REVENUE_SHARE") return [];
  const supabase = createAdminClient();
  const [{ data: spans }, { data: reservations }] = await Promise.all([
    supabase.from("investor_allocations").select("id, effective_from, effective_to").eq("vehicle_id", allocation.vehicle_id),
    supabase.from("reservations").select("id, number, total_cents, completed_at, actual_return_at, return_at").eq("assigned_vehicle_id", allocation.vehicle_id).eq("status", "COMPLETED").order("completed_at", { ascending: false }).limit(1000),
  ]);
  const due = ((reservations ?? []) as Array<Completion & { id: string; number: string; total_cents: number | null }>)
    .map((reservation) => ({ ...reservation, completedAt: completionOf(reservation) }))
    .map((reservation) => ({ ...reservation, date: zonedParts(reservation.completedAt, zone).date }))
    .filter((reservation) => coveringAllocation((spans ?? []) as AllocationSpan[], reservation.date)?.id === allocation.id);
  if (!due.length) return [];
  const posted = await sharedReservations(due.map((reservation) => reservation.id), allocation.id);
  const open = due.filter((reservation) => !posted.has(reservation.id));
  if (!open.length) return [];
  const lines = new Map<string, DatedLine[]>();
  for (const ids of chunks(open.map((reservation) => reservation.id))) {
    const { data: items } = await supabase.from("reservation_line_items").select("reservation_id, type, code, amount_cents, created_at").in("reservation_id", ids);
    for (const item of (items ?? []) as Array<DatedLine & { reservation_id: string }>) lines.set(item.reservation_id, [...(lines.get(item.reservation_id) ?? []), item]);
  }
  const refunds = await refundsAfterCompletion(new Map(open.map((reservation) => [reservation.id, reservation.completedAt])));
  return open
    .map((reservation) => {
      const quote = backfillQuote({ lines: lines.get(reservation.id) ?? [], completedAt: reservation.completedAt, refundedCents: refunds.get(reservation.id) ?? 0, totalCents: reservation.total_cents ?? 0, revenueShareBps: allocation.revenue_share_bps, shareBps: allocation.share_bps });
      return { reservationId: reservation.id, number: reservation.number, date: reservation.date, completedAt: reservation.completedAt, amountCents: quote.netCents };
    })
    .filter((row) => row.amountCents > 0)
    .sort((a, b) => Date.parse(a.completedAt) - Date.parse(b.completedAt))
    .map(({ reservationId, number, date, amountCents }) => ({ reservationId, number, date, amountCents }));
}

export async function adjustShareForRefund(reservationId: string, deltaRefundCents: number) {
  if (deltaRefundCents <= 0) return;
  const supabase = createAdminClient();
  const { data: entries } = await supabase
    .from("investor_ledger_entries")
    .select("id, investor_id, type, bucket, amount_cents, settles_at, settled_at, reservation_id, vehicle_id, allocation_id, metadata, memo")
    .eq("reservation_id", reservationId)
    .eq("type", "RENTAL_SHARE")
    .is("reversal_of", null);
  if (!entries?.length) return;
  const { data: reversals } = await supabase.from("investor_ledger_entries").select("reversal_of").in("reversal_of", entries.map((entry) => entry.id));
  const reversed = new Set((reversals ?? []).map((row) => row.reversal_of as string));
  const live = (entries as unknown as LedgerEntry[]).filter((entry) => !reversed.has(entry.id));
  if (!live.length) return;
  const { data: reservation } = await supabase.from("reservations").select("number, total_cents").eq("id", reservationId).maybeSingle();
  const total = reservation?.total_cents ?? 0;
  if (total <= 0) return;
  const proportion = Math.min(1, deltaRefundCents / total);
  for (const entry of live) {
    const amountCents = -Math.round(entry.amount_cents * proportion);
    if (amountCents === 0) continue;
    const memo = `Refund ${reservation?.number ?? ""} ${formatMoney(deltaRefundCents)}`.trim();
    const pending = entry.bucket === "PENDING";
    try {
      await postEntries(entry.investor_id, [{ type: "ADJUSTMENT", bucket: pending ? "PENDING" : "AVAILABLE", amountCents, settlesAt: pending ? entry.settles_at : null, reservationId, vehicleId: entry.vehicle_id, allocationId: entry.allocation_id, memo, metadata: { refundCents: deltaRefundCents, source: "refund" } }]);
    } catch (cause) {
      if (cause instanceof LedgerError && cause.message === "insufficient_available") {
        await postEntries(entry.investor_id, [{ type: "ADJUSTMENT", bucket: "PENDING", amountCents, settlesAt: new Date().toISOString(), reservationId, vehicleId: entry.vehicle_id, allocationId: entry.allocation_id, memo, metadata: { refundCents: deltaRefundCents, source: "refund", deferred: true } }]);
      } else throw cause;
    }
    await audit({ actorType: "SYSTEM", action: "investor.share_refund_adjusted", entityType: "reservation", entityId: reservationId, metadata: { investorId: entry.investor_id, amountCents, refundCents: deltaRefundCents } });
  }
}

export async function settleDueShares() {
  const { data, error } = await createAdminClient().rpc("investor_settle_due");
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as Array<{ entry_id: string; investor_id: string; amount_cents: number; reservation_id: string | null }>;
  const byInvestor = new Map<string, number>();
  for (const row of rows) byInvestor.set(row.investor_id, (byInvestor.get(row.investor_id) ?? 0) + row.amount_cents);
  for (const [investorId, amount] of byInvestor) {
    if (amount > 0) await notifyInvestorEvent(investorId, "share_settled", { amount: formatMoney(amount) }, "/funds");
  }
  if (rows.length) await audit({ actorType: "SYSTEM", action: "investor.shares_settled", entityType: "investor_ledger", metadata: { entries: rows.length, investors: byInvestor.size } });
  return { settled: rows.length, investors: byInvestor.size };
}
