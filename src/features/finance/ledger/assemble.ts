import { coveringAllocation } from "../../investor/share-math";
import { laDate, lastDayOf } from "./dates";
import { ownerEntryShape, type OwnerEntry } from "./other-targets";
import type { StripeTxn } from "./stripe-targets";
import { RULES_VERSION, type PostingItem, type Reason, type Target } from "./types";

export type PostedRow = {
  source_key: string;
  source_id: string;
  account: string;
  reservation_id: string | null;
  vehicle_id: string | null;
  location_id: string | null;
  investor_id: string | null;
  expense_id: string | null;
  stripe_id: string | null;
  revenue_class: string | null;
  balance: number;
};

type Dims = Omit<PostedRow, "source_key" | "source_id" | "balance">;

const dimsKey = (row: Partial<Dims> & { account: string }) =>
  JSON.stringify([row.account, row.reservation_id ?? null, row.vehicle_id ?? null, row.location_id ?? null, row.investor_id ?? null, row.expense_id ?? null, row.stripe_id ?? null, row.revenue_class ?? null]);

export function postedByKey(rows: PostedRow[]) {
  const out = new Map<string, { sourceId: string; balances: Map<string, number> }>();
  for (const row of rows) {
    const entry = out.get(row.source_key) ?? { sourceId: row.source_id, balances: new Map<string, number>() };
    const key = dimsKey(row);
    entry.balances.set(key, (entry.balances.get(key) ?? 0) + Number(row.balance));
    out.set(row.source_key, entry);
  }
  for (const entry of out.values()) for (const [key, value] of entry.balances) if (value === 0) entry.balances.delete(key);
  return out;
}

function wantedOf(targets: Target[]) {
  const out = new Map<string, number>();
  for (const target of targets) out.set(dimsKey(target), (out.get(dimsKey(target)) ?? 0) + target.amount);
  for (const [key, value] of out) if (value === 0) out.delete(key);
  return out;
}

const same = (a: Map<string, number>, b: Map<string, number>) => a.size === b.size && [...a].every(([key, value]) => b.get(key) === value);

const grewOnly = (wanted: Map<string, number>, current: Map<string, number>) =>
  [...current.keys()].every((key) => wanted.has(key)) &&
  [...wanted].every(([key, value]) => {
    const before = current.get(key) ?? 0;
    return before === 0 || (Math.sign(before) === Math.sign(value) && Math.abs(value) >= Math.abs(before));
  });

const sourceTypes: Record<string, string> = { order: "reservation", stripe: "stripe_txn", payout: "stripe_payout", dispute: "stripe_dispute", offpay: "payment", offref: "refund", ownerledger: "investor_ledger", expense: "expense", resolution: "resolution", settle: "settlement" };
export const sourceTypeOfKey = (key: string) => sourceTypes[key.split(":")[0]] ?? "unknown";

export function reversalDate(key: string, today: string) {
  const day = key.match(/:(\d{4}-\d{2}-\d{2})$/)?.[1];
  const month = key.match(/:(\d{4}-\d{2})$/)?.[1];
  const date = day ?? (month ? lastDayOf(month) : today);
  return date < today ? date : today;
}

export type Plan = { toPost: PostingItem[]; unchanged: number; reversals: number };

export function planPostings(input: { built: PostingItem[]; posted: PostedRow[]; reversible: (key: string, sourceId: string) => boolean; today: string }): Plan {
  const posted = postedByKey(input.posted);
  const seen = new Set<string>();
  const toPost: PostingItem[] = [];
  let unchanged = 0;
  for (const entry of input.built) {
    if (seen.has(entry.source_key)) throw new Error(`duplicate_key:${entry.source_key}`);
    seen.add(entry.source_key);
    const wanted = wantedOf(entry.targets);
    const current = posted.get(entry.source_key)?.balances ?? new Map<string, number>();
    if (same(wanted, current)) {
      unchanged += 1;
      continue;
    }
    const grown = /:(rec|own):/.test(entry.source_key) && grewOnly(wanted, current);
    const reason: Reason = current.size === 0 || grown ? "NEW" : wanted.size === 0 ? "SOURCE_DELETED" : entry.source_type === "reservation" ? "REPRICE" : "CORRECTION";
    toPost.push({ ...entry, reason });
  }
  let reversals = 0;
  for (const [key, entry] of posted) {
    if (seen.has(key) || entry.balances.size === 0 || !input.reversible(key, entry.sourceId)) continue;
    reversals += 1;
    toPost.push({ source_type: sourceTypeOfKey(key), source_id: entry.sourceId, source_key: key, economic_date: reversalDate(key, input.today), rule_version: RULES_VERSION, reason: "SOURCE_DELETED", inputs: { vanished: true }, memo: null, targets: [] });
  }
  return { toPost, unchanged, reversals };
}

export const chunk = <T>(rows: T[], size: number) => Array.from({ length: Math.ceil(rows.length / size) }, (_, index) => rows.slice(index * size, index * size + size));

export function ownerOriginals(entries: OwnerEntry[]) {
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  return (entry: OwnerEntry) => (entry.reversal_of ? byId.get(entry.reversal_of) ?? null : null);
}

export function ledgerShareByOrder(entries: OwnerEntry[]) {
  const original = ownerOriginals(entries);
  const out = new Map<string, number>();
  for (const entry of entries) {
    if (!entry.reservation_id || ownerEntryShape(entry, original(entry)) !== "share") continue;
    const key = `${entry.investor_id}:${entry.reservation_id}`;
    out.set(key, (out.get(key) ?? 0) + entry.amount_cents);
  }
  return out;
}

export function withdrawalsFromEarnings(entries: OwnerEntry[]) {
  const original = ownerOriginals(entries);
  const sorted = [...entries].sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
  const earnings = new Map<string, number>();
  const out = new Map<string, number>();
  for (const entry of sorted) {
    const shape = ownerEntryShape(entry, original(entry));
    const current = earnings.get(entry.investor_id) ?? 0;
    if (shape === "share" || shape === "mileage" || shape === "manual") earnings.set(entry.investor_id, current + entry.amount_cents);
    if (shape !== "withdrawal") continue;
    if (entry.amount_cents >= 0) {
      const taken = Math.min(entry.amount_cents, Math.max(0, current));
      out.set(entry.id, taken);
      earnings.set(entry.investor_id, current - taken);
    } else {
      const source = original(entry);
      const restored = -Math.min(-entry.amount_cents, source ? out.get(source.id) ?? 0 : 0);
      out.set(entry.id, restored);
      earnings.set(entry.investor_id, current - restored);
    }
  }
  return out;
}

export function liveIntents(txns: StripeTxn[]) {
  return new Set(txns.filter((txn) => txn.livemode && txn.payment_intent_id).map((txn) => txn.payment_intent_id as string));
}

const customerCategories = new Set(["charge", "payment", "refund", "payment_refund", "charge_failure", "payment_failure_refund", "refund_failure"]);

export function damageNets(claims: Array<{ id: string; reservation_id: string; payment_id: string | null }>, intentOfPayment: Map<string, string>, txns: StripeTxn[]) {
  const byIntent = new Map<string, StripeTxn[]>();
  for (const txn of txns) {
    if (!txn.livemode || !txn.payment_intent_id || !(customerCategories.has(txn.category) || customerCategories.has(txn.type))) continue;
    byIntent.set(txn.payment_intent_id, [...(byIntent.get(txn.payment_intent_id) ?? []), txn]);
  }
  const out: Array<{ claimId: string; reservationId: string; netCents: number; date: string }> = [];
  for (const claim of claims) {
    const intent = claim.payment_id ? intentOfPayment.get(claim.payment_id) : undefined;
    const rows = intent ? byIntent.get(intent) ?? [] : [];
    if (rows.length === 0) continue;
    const first = [...rows].sort((a, b) => a.created_at.localeCompare(b.created_at))[0];
    out.push({ claimId: claim.id, reservationId: claim.reservation_id, netCents: rows.reduce((sum, row) => sum + row.amount_cents, 0), date: laDate(first.created_at) });
  }
  return out;
}

export type AllocationRow = { id: string; investor_id: string; vehicle_id: string; share_bps: number; revenue_share_bps: number; effective_from: string; effective_to: string | null; compensation: string | null };

export function vehicleAllocation(vehicleId: string | null, allocations: AllocationRow[], onDate: string) {
  if (!vehicleId) return null;
  return coveringAllocation(allocations.filter((allocation) => allocation.vehicle_id === vehicleId), onDate);
}
