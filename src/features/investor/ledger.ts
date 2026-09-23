import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

export const ledgerTypes = ["CAPITAL_IN", "CAPITAL_ALLOCATED", "RENTAL_SHARE", "ADJUSTMENT", "CAPITAL_RETURN", "WITHHELD", "WITHHOLD_RELEASE", "WITHDRAWAL", "REVERSAL"] as const;
export type LedgerType = (typeof ledgerTypes)[number];
export const ledgerBuckets = ["AVAILABLE", "PENDING", "INVESTED", "PAID_OUT"] as const;
export type LedgerBucket = (typeof ledgerBuckets)[number];

export type LedgerEntry = {
  id: string;
  investor_id: string;
  type: LedgerType;
  bucket: LedgerBucket;
  amount_cents: number;
  settles_at: string | null;
  settled_at: string | null;
  reservation_id: string | null;
  vehicle_id: string | null;
  allocation_id: string | null;
  contribution_id: string | null;
  withdrawal_id: string | null;
  reversal_of: string | null;
  memo: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  reservation: { number: string } | null;
  vehicle: { fleet_number: string } | null;
};

export type EntryInput = {
  type: LedgerType;
  bucket: LedgerBucket;
  amountCents: number;
  settlesAt?: string | null;
  reservationId?: string | null;
  vehicleId?: string | null;
  allocationId?: string | null;
  contributionId?: string | null;
  withdrawalId?: string | null;
  reversalOf?: string | null;
  memo?: string | null;
  metadata?: Record<string, unknown>;
  createdBy?: string | null;
};

export class LedgerError extends Error {}

export async function postEntries(investorId: string, entries: EntryInput[]): Promise<string[]> {
  const payload = entries.map((entry) => ({
    type: entry.type,
    bucket: entry.bucket,
    amount_cents: Math.trunc(entry.amountCents),
    settles_at: entry.settlesAt ?? null,
    reservation_id: entry.reservationId ?? null,
    vehicle_id: entry.vehicleId ?? null,
    allocation_id: entry.allocationId ?? null,
    contribution_id: entry.contributionId ?? null,
    withdrawal_id: entry.withdrawalId ?? null,
    reversal_of: entry.reversalOf ?? null,
    memo: entry.memo ?? null,
    metadata: entry.metadata ?? {},
    created_by: entry.createdBy ?? null,
  }));
  const { data, error } = await createAdminClient().rpc("investor_post", { p_investor_id: investorId, p_entries: payload });
  if (error) throw new LedgerError(/insufficient_available/.test(error.message) ? "insufficient_available" : error.message);
  return (data ?? []) as string[];
}

export type InvestorBalances = { availableCents: number; pendingCents: number; heldCents: number; investedCents: number; withdrawnCents: number; activeAllocations: number };

export async function loadBalances(investorId: string): Promise<InvestorBalances> {
  const { data } = await createAdminClient().from("investor_balances").select("available_cents, pending_cents, held_cents, invested_cents, withdrawn_cents, active_allocations").eq("investor_id", investorId).maybeSingle();
  return {
    availableCents: data?.available_cents ?? 0,
    pendingCents: data?.pending_cents ?? 0,
    heldCents: data?.held_cents ?? 0,
    investedCents: data?.invested_cents ?? 0,
    withdrawnCents: data?.withdrawn_cents ?? 0,
    activeAllocations: data?.active_allocations ?? 0,
  };
}

export async function canCloseInvestor(investorId: string) {
  const balances = await loadBalances(investorId);
  return balances.availableCents === 0 && balances.pendingCents === 0 && balances.heldCents === 0 && balances.investedCents === 0 && balances.activeAllocations === 0;
}

const entryColumns = "id, investor_id, type, bucket, amount_cents, settles_at, settled_at, reservation_id, vehicle_id, allocation_id, contribution_id, withdrawal_id, reversal_of, memo, metadata, created_at, reservation:reservations(number), vehicle:vehicles(fleet_number)";

export async function listEntries(investorId: string, options: { limit?: number; types?: LedgerType[]; vehicleId?: string; from?: string; to?: string } = {}): Promise<LedgerEntry[]> {
  let query = createAdminClient().from("investor_ledger_entries").select(entryColumns).eq("investor_id", investorId).order("created_at", { ascending: false }).limit(options.limit ?? 200);
  if (options.types?.length) query = query.in("type", options.types);
  if (options.vehicleId) query = query.eq("vehicle_id", options.vehicleId);
  if (options.from) query = query.gte("created_at", options.from);
  if (options.to) query = query.lt("created_at", options.to);
  const { data } = await query;
  return (data ?? []) as unknown as LedgerEntry[];
}

export async function getEntry(id: string): Promise<LedgerEntry | null> {
  const { data } = await createAdminClient().from("investor_ledger_entries").select(entryColumns).eq("id", id).maybeSingle();
  return (data as unknown as LedgerEntry | null) ?? null;
}

const zone = "America/Los_Angeles";
const weekday = new Intl.DateTimeFormat("en-US", { timeZone: zone, weekday: "short" });

export function businessDaysAfter(start: Date, days: number) {
  let cursor = start.getTime();
  let counted = 0;
  while (counted < days) {
    cursor += 86400000;
    const name = weekday.format(new Date(cursor));
    if (name !== "Sat" && name !== "Sun") counted += 1;
  }
  return new Date(cursor);
}
