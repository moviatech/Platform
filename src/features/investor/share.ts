import "server-only";
import { zonedParts } from "@/features/booking/time";
import { audit } from "@/lib/audit";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatMoney } from "@/lib/utils/format";
import type { Allocation } from "./contributions";
import { businessDaysAfter, LedgerError, postEntries, type LedgerEntry } from "./ledger";
import { notifyInvestorEvent } from "./notify";
import { loadInvestorSettings } from "./settings";

export type ShareBase = { rentalCents: number; discountCents: number; baseCents: number };

type Line = { type: string; code: string; amount_cents: number };

export function computeShareBase(lines: Line[]): ShareBase {
  const excluded = new Set(["TAX", "ADDITIONAL"]);
  const rentalCents = lines.filter((line) => line.type === "RENTAL").reduce((sum, line) => sum + line.amount_cents, 0);
  const positive = lines.filter((line) => line.amount_cents > 0 && !excluded.has(line.type)).reduce((sum, line) => sum + line.amount_cents, 0);
  const discounts = -lines.filter((line) => line.amount_cents < 0 && !excluded.has(line.type)).reduce((sum, line) => sum + line.amount_cents, 0);
  const discountCents = positive > 0 ? Math.min(rentalCents, Math.round((discounts * rentalCents) / positive)) : 0;
  return { rentalCents, discountCents, baseCents: Math.max(0, rentalCents - discountCents) };
}

export const shareOf = (baseCents: number, revenueShareBps: number, shareBps: number) => Math.round((((baseCents * revenueShareBps) / 10000) * shareBps) / 10000);

export async function findAllocationForVehicle(vehicleId: string, onDate: string): Promise<Allocation | null> {
  const { data } = await createAdminClient()
    .from("investor_allocations")
    .select("id, investor_id, vehicle_id, contribution_id, source, share_bps, revenue_share_bps, cost_basis_cents, effective_from, effective_to, status, exit_note, created_at")
    .eq("vehicle_id", vehicleId)
    .lte("effective_from", onDate)
    .or(`effective_to.is.null,effective_to.gte.${onDate}`)
    .order("effective_from", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as unknown as Allocation | null) ?? null;
}

export async function postRentalShare(reservationId: string): Promise<{ posted: boolean; reason?: string; amountCents?: number }> {
  const supabase = createAdminClient();
  const { data: reservation } = await supabase.from("reservations").select("id, number, status, assigned_vehicle_id, total_cents, completed_at, actual_return_at, return_at").eq("id", reservationId).maybeSingle();
  if (!reservation || reservation.status !== "COMPLETED" || !reservation.assigned_vehicle_id) return { posted: false, reason: "not_completed" };
  const completedAt = reservation.completed_at ?? reservation.actual_return_at ?? reservation.return_at;
  const onDate = zonedParts(completedAt, "America/Los_Angeles").date;
  const allocation = await findAllocationForVehicle(reservation.assigned_vehicle_id, onDate);
  if (!allocation) return { posted: false, reason: "no_allocation" };
  const { data: lines } = await supabase.from("reservation_line_items").select("type, code, amount_cents").eq("reservation_id", reservationId);
  const base = computeShareBase((lines ?? []) as Line[]);
  const amountCents = shareOf(base.baseCents, allocation.revenue_share_bps, allocation.share_bps);
  if (amountCents <= 0) return { posted: false, reason: "zero" };
  const settings = await loadInvestorSettings();
  const settlesAt = businessDaysAfter(new Date(completedAt), settings.settlementBusinessDays).toISOString();
  try {
    await postEntries(allocation.investor_id, [
      {
        type: "RENTAL_SHARE",
        bucket: "PENDING",
        amountCents,
        settlesAt,
        reservationId,
        vehicleId: reservation.assigned_vehicle_id,
        allocationId: allocation.id,
        memo: reservation.number,
        metadata: { ...base, totalCents: reservation.total_cents, revenueShareBps: allocation.revenue_share_bps, shareBps: allocation.share_bps, completedAt },
      },
    ]);
  } catch (cause) {
    if (cause instanceof LedgerError && /investor_ledger_rental_share_idx|duplicate/.test(cause.message)) return { posted: false, reason: "duplicate" };
    throw cause;
  }
  await audit({ actorType: "SYSTEM", action: "investor.share_posted", entityType: "reservation", entityId: reservationId, metadata: { investorId: allocation.investor_id, allocationId: allocation.id, amountCents, ...base } });
  await notifyInvestorEvent(allocation.investor_id, "share_posted", { amount: formatMoney(amountCents), number: reservation.number }, `/assets/${allocation.id}`, { email: false, dedupeKey: `share_posted:${reservationId}` });
  return { posted: true, amountCents };
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
  const { data: reservation } = await supabase.from("reservations").select("number, total_cents").eq("id", reservationId).maybeSingle();
  const total = reservation?.total_cents ?? 0;
  if (total <= 0) return;
  const proportion = Math.min(1, deltaRefundCents / total);
  for (const entry of entries as unknown as LedgerEntry[]) {
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
