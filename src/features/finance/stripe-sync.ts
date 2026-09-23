import "server-only";
import { audit } from "@/lib/audit";
import { getStripe, stripeConfigured, stripeLive } from "@/lib/stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { rangeBounds } from "./queries";
import { monthRange } from "./report";
import { mapTransaction, reconcile, stripeFees, summarizeStripe, type LedgerRow, type Mismatch, type StripeSummary } from "./stripe-ledger";

const day = 86400;
const maxRows = 20000;

function chunks<T>(items: T[], size: number) {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size));
  return result;
}

async function pageAll<T>(build: (from: number, to: number) => PromiseLike<{ data: unknown[] | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let offset = 0; offset < maxRows; offset += 1000) {
    const { data } = await build(offset, offset + 999);
    out.push(...((data ?? []) as T[]));
    if ((data ?? []).length < 1000) break;
  }
  return out;
}

export type SyncResult = { transactions: number; payouts: number; linked: number };

export async function syncStripe(options: { full?: boolean; actor?: { userId: string; displayName: string } } = {}): Promise<SyncResult> {
  const stripe = getStripe();
  const supabase = createAdminClient();
  const livemode = stripeLive();
  const { data: last } = await supabase.from("stripe_balance_transactions").select("created_at").eq("livemode", livemode).order("created_at", { ascending: false }).limit(1).maybeSingle();
  const since = options.full || !last ? null : Math.floor(Date.parse(last.created_at as string) / 1000) - 3 * day;

  const rows: LedgerRow[] = [];
  for await (const item of stripe.balanceTransactions.list({ limit: 100, ...(since ? { created: { gte: since } } : {}), expand: ["data.source"] })) {
    rows.push(mapTransaction(item, livemode));
    if (rows.length >= maxRows) break;
  }
  const syncedAt = new Date().toISOString();
  for (const batch of chunks(rows, 500)) {
    const { error } = await supabase.from("stripe_balance_transactions").upsert(batch.map((row) => ({ ...row, synced_at: syncedAt })), { onConflict: "id" });
    if (error) throw new Error(error.message);
  }

  let payouts = 0;
  for await (const payout of stripe.payouts.list({ limit: 100, ...(since ? { created: { gte: since - 30 * day } } : {}) })) {
    const { error } = await supabase.from("stripe_payouts").upsert({ id: payout.id, livemode, amount_cents: payout.amount, currency: payout.currency, status: payout.status, method: payout.method, automatic: payout.automatic, arrival_date: new Date(payout.arrival_date * 1000).toISOString(), created_at: new Date(payout.created * 1000).toISOString(), synced_at: syncedAt }, { onConflict: "id" });
    if (error) throw new Error(error.message);
    payouts += 1;
    if (payouts >= 2000) break;
  }

  let linked = 0;
  const { data: open } = await supabase.from("stripe_payouts").select("id, status").eq("livemode", livemode).eq("automatic", true).is("linked_at", null).in("status", ["paid", "in_transit"]).limit(200);
  for (const payout of open ?? []) {
    const ids: string[] = [];
    for await (const item of stripe.balanceTransactions.list({ payout: payout.id as string, limit: 100 })) {
      if (item.type !== "payout") ids.push(item.id);
      if (ids.length >= maxRows) break;
    }
    for (const batch of chunks(ids, 200)) await supabase.from("stripe_balance_transactions").update({ payout_id: payout.id }).in("id", batch);
    linked += ids.length;
    if (payout.status === "paid") await supabase.from("stripe_payouts").update({ linked_at: syncedAt }).eq("id", payout.id);
  }
  if (options.actor) await audit({ actorUserId: options.actor.userId, actorType: "STAFF", action: "stripe.synced", entityType: "stripe", metadata: { by: options.actor.displayName, count: rows.length, payouts, linked, full: Boolean(options.full) } });
  return { transactions: rows.length, payouts, linked };
}

export async function liveStripeFees(month: string): Promise<number> {
  const range = monthRange(month);
  const { start, end } = rangeBounds({ from: range.from, to: range.to });
  const supabase = createAdminClient();
  return stripeFees(await pageAll<Pick<LedgerRow, "category" | "amount_cents" | "fee_cents" | "net_cents">>((from, to) => supabase.from("stripe_balance_transactions").select("category, amount_cents, fee_cents, net_cents").eq("livemode", true).gte("created_at", start).lt("created_at", end).order("id").range(from, to)));
}

export type PayoutRow = { id: string; amount_cents: number; status: string; method: string | null; arrival_date: string | null; created_at: string; transactions: number };

export type StripeMonth = {
  configured: boolean;
  live: boolean;
  summary: StripeSummary;
  payouts: PayoutRow[];
  matched: number;
  mismatches: Mismatch[];
  syncedAt: string | null;
  balance: { availableCents: number; pendingCents: number } | null;
};

export async function loadStripeMonth(month: string): Promise<StripeMonth> {
  const supabase = createAdminClient();
  const live = stripeLive();
  const range = monthRange(month);
  const { start, end } = rangeBounds({ from: range.from, to: range.to });
  type MonthRow = { id: string; category: string; amount_cents: number; fee_cents: number; net_cents: number; payment_intent_id: string | null; payout_id: string | null; created_at: string };
  type PaymentRow = { id: string; stripe_payment_intent_id: string; amount_captured_cents: number; reservation: { number: string } | null };
  const [rows, { data: payoutRows }, payments, { data: last }] = await Promise.all([
    pageAll<MonthRow>((from, to) => supabase.from("stripe_balance_transactions").select("id, category, amount_cents, fee_cents, net_cents, payment_intent_id, payout_id, created_at").eq("livemode", live).gte("created_at", start).lt("created_at", end).order("created_at").order("id").range(from, to)),
    supabase.from("stripe_payouts").select("id, amount_cents, status, method, arrival_date, created_at").eq("livemode", live).gte("arrival_date", start).lt("arrival_date", end).order("arrival_date", { ascending: false }).limit(500),
    pageAll<PaymentRow>((from, to) => supabase.from("payments").select("id, stripe_payment_intent_id, amount_captured_cents, reservation:reservations(number)").not("stripe_payment_intent_id", "is", null).in("status", ["SUCCEEDED", "PARTIALLY_REFUNDED", "REFUNDED"]).gt("amount_captured_cents", 0).gte("created_at", start).lt("created_at", end).order("id").range(from, to)),
    supabase.from("stripe_balance_transactions").select("synced_at").eq("livemode", live).order("synced_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  const counts = new Map<string, number>();
  const { data: linked } = await supabase.from("stripe_balance_transactions").select("payout_id").in("payout_id", (payoutRows ?? []).map((row) => row.id as string).slice(0, 200));
  for (const row of linked ?? []) counts.set(row.payout_id as string, (counts.get(row.payout_id as string) ?? 0) + 1);
  const { matched, mismatches } = reconcile(
    rows.filter((row) => row.category === "charge" || row.category === "payment").map((row) => ({ id: row.id, intent: row.payment_intent_id, amountCents: row.amount_cents, createdAt: row.created_at })),
    payments.map((payment) => ({ id: payment.id, intent: payment.stripe_payment_intent_id, capturedCents: payment.amount_captured_cents, number: payment.reservation?.number ?? null })),
  );
  let balance: StripeMonth["balance"] = null;
  if (stripeConfigured()) {
    try {
      const current = await getStripe().balance.retrieve();
      balance = { availableCents: current.available.reduce((sum, item) => sum + item.amount, 0), pendingCents: current.pending.reduce((sum, item) => sum + item.amount, 0) };
    } catch {
      balance = null;
    }
  }
  return {
    configured: stripeConfigured(),
    live,
    summary: summarizeStripe(rows),
    payouts: ((payoutRows ?? []) as Array<Omit<PayoutRow, "transactions">>).map((row) => ({ ...row, transactions: counts.get(row.id) ?? 0 })),
    matched,
    mismatches,
    syncedAt: (last?.synced_at as string | undefined) ?? null,
    balance,
  };
}

export async function listStripeLedger(from: string, to: string) {
  const { start, end } = rangeBounds({ from, to });
  const supabase = createAdminClient();
  const live = stripeLive();
  return pageAll<LedgerRow & { payout_id: string | null }>((from, to) => supabase.from("stripe_balance_transactions").select("id, type, category, amount_cents, fee_cents, net_cents, status, description, source_id, payment_intent_id, payout_id, created_at, available_on").eq("livemode", live).gte("created_at", start).lt("created_at", end).order("created_at").order("id").range(from, to));
}
