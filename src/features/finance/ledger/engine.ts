import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { readAll } from "../paging";
import { testOrderColumns, testOrderOf, type TestOrderRow } from "../test-orders";
import { chunk, damageNets, ledgerShareByOrder, liveIntents, ownerOriginals, planPostings, sourceTypeOfKey, vehicleAllocation, withdrawalsFromEarnings, type AllocationRow, type PostedRow } from "./assemble";
import { laDate } from "./dates";
import { checkGate } from "./gate";
import { investorIncluded, orderInclusion, pendingInclusionIssue, type Inclusion } from "./inclusion";
import { activeMappings, type Mapping } from "./mapping";
import { priceHistory, type SnapshotRow } from "./history";
import { orderTargets, type OrderFacts, type OrderLine } from "./order-targets";
import { expenseTargets, offlinePaymentTargets, offlineRefundTargets, ownerEntryShape, ownerLedgerTargets, resolutionTargets, settlementTargets, type ExpenseRow, type OwnerEntry, type ResolutionRow, type SettlementRow } from "./other-targets";
import { disputeLostTargets, payoutArrivalTargets, stripeTargets, type StripePayout, type StripeTxn } from "./stripe-targets";
import type { Built, Issue, PostingItem } from "./types";

export type Book = "live" | "sandbox";
export const financeBook = (): Book => (process.env.FINANCE_BOOK === "live" ? "live" : "sandbox");
export const financeLiveKey = () => process.env.FINANCE_LIVE_KEY ?? null;

type OrderRow = TestOrderRow & {
  id: string;
  number: string;
  status: string;
  actual_pickup_at: string | null;
  return_at: string;
  actual_return_at: string | null;
  cancelled_at: string | null;
  completed_at: string | null;
  assigned_vehicle_id: string | null;
  pickup_location_id: string | null;
  total_cents: number;
  updated_at: string;
};
type LineRow = OrderLine & { reservation_id: string };
type PaymentRow = { id: string; reservation_id: string; kind: string; status: string; amount_captured_cents: number; offline_method: string | null; stripe_payment_intent_id: string | null; created_at: string };
type RefundRow = { id: string; payment_id: string; amount_cents: number; status: string; offline_method: string | null; created_at: string };
type AuditRow = { action: string; entity_type: string; entity_id: string | null; metadata: Record<string, unknown> | null; created_at: string };
type InvestorRow = { id: string; house: boolean };

export type EngineResult = {
  book: Book;
  orders: number;
  built: number;
  unchanged: number;
  toPost: number;
  posted: number;
  reversals: number;
  failed: number;
  gateSkipped: number;
  issues: number;
  stopped: boolean;
};

const orderColumns = `id, number, status, actual_pickup_at, return_at, actual_return_at, cancelled_at, completed_at, assigned_vehicle_id, pickup_location_id, total_cents, updated_at, ${testOrderColumns}`;
const postable = new Set(["ACTIVE", "COMPLETED", "CANCELLED", "NO_SHOW"]);
const audited = ["reservation.cancellation_settled", "reservation.no_show_settled", "payment.dispute_lost"];

async function inChunks<T>(ids: string[], load: (part: string[]) => Promise<T[]>) {
  const out: T[] = [];
  for (const part of chunk(ids, 100)) out.push(...(await load(part)));
  return out;
}

const snapshotColumns = "id, source_table, source_id, captured_at, fields, deleted";

async function loadHistories(supabase: ReturnType<typeof createAdminClient>, orderIds: string[]) {
  const out = new Map<string, SnapshotRow[]>();
  if (orderIds.length === 0) return out;
  const add = (orderId: string | undefined, row: SnapshotRow) => {
    if (!orderId) return;
    out.set(orderId, [...(out.get(orderId) ?? []), row]);
  };
  const lineRows = await inChunks(orderIds, (part) => readAll<SnapshotRow>((from, to) => supabase.from("fin_source_snapshots").select(snapshotColumns).eq("source_table", "reservation_line_items").eq("deleted", false).in("fields->>reservation_id", part).order("id").range(from, to), { maxRows: 100000, strict: true }));
  const lineOrder = new Map<string, string>();
  for (const row of lineRows) {
    lineOrder.set(row.source_id, String(row.fields.reservation_id));
    add(String(row.fields.reservation_id), row);
  }
  const removed = await inChunks([...lineOrder.keys()], (part) => readAll<SnapshotRow>((from, to) => supabase.from("fin_source_snapshots").select(snapshotColumns).eq("source_table", "reservation_line_items").eq("deleted", true).in("source_id", part).order("id").range(from, to), { maxRows: 100000, strict: true }));
  for (const row of removed) add(lineOrder.get(row.source_id), row);
  const orderRows = await inChunks(orderIds, (part) => readAll<SnapshotRow>((from, to) => supabase.from("fin_source_snapshots").select(snapshotColumns).eq("source_table", "reservations").in("source_id", part).order("id").range(from, to), { maxRows: 100000, strict: true }));
  for (const row of orderRows) add(row.source_id, row);
  return out;
}

export async function runEngine(options: { book: Book; liveKey: string | null; deadline: number; now?: number }): Promise<EngineResult> {
  const supabase = createAdminClient();
  const now = options.now ?? Date.now();
  const today = laDate(now);
  const book = options.book;

  const [mappings, inclusionRows, posted, orders, payments, refunds, txns, payouts, audits, claims, investors, allocations, entries, statements, expenses, resolutions, settlements] = await Promise.all([
    readAll<Mapping>((from, to) => supabase.from("fin_mappings").select("kind, match, account, mode, version, effective_from").order("id").range(from, to), { strict: true }),
    readAll<{ object_type: string; object_id: string; included: boolean }>((from, to) => supabase.from("fin_inclusions").select("object_type, object_id, included").order("object_id").range(from, to), { strict: true }),
    readAll<PostedRow>(
      (from, to) =>
        supabase
          .rpc("fin_source_balances", { p_book: book, p_source_type: null, p_key_prefix: null })
          .order("source_key")
          .order("account")
          .order("reservation_id")
          .order("vehicle_id")
          .order("location_id")
          .order("investor_id")
          .order("expense_id")
          .order("stripe_id")
          .order("revenue_class")
          .range(from, to),
      { maxRows: 200000, strict: true },
    ),
    readAll<OrderRow>((from, to) => supabase.from("reservations").select(orderColumns).order("id").range(from, to), { maxRows: 100000, strict: true }),
    readAll<PaymentRow>((from, to) => supabase.from("payments").select("id, reservation_id, kind, status, amount_captured_cents, offline_method, stripe_payment_intent_id, created_at").order("id").range(from, to), { maxRows: 200000, strict: true }),
    readAll<RefundRow>((from, to) => supabase.from("refunds").select("id, payment_id, amount_cents, status, offline_method, created_at").order("id").range(from, to), { maxRows: 200000, strict: true }),
    readAll<StripeTxn>((from, to) => supabase.from("stripe_balance_transactions").select("id, livemode, type, category, amount_cents, fee_cents, net_cents, currency, payment_intent_id, created_at").eq("livemode", true).order("id").range(from, to), { maxRows: 500000, strict: true }),
    readAll<StripePayout>((from, to) => supabase.from("stripe_payouts").select("id, livemode, status, amount_cents, arrival_date, created_at").eq("livemode", true).order("id").range(from, to), { strict: true }),
    readAll<AuditRow>((from, to) => supabase.from("audit_events").select("action, entity_type, entity_id, metadata, created_at").in("action", audited).order("created_at").order("id").range(from, to), { maxRows: 100000, strict: true }),
    readAll<{ id: string; reservation_id: string; payment_id: string | null }>((from, to) => supabase.from("damage_claims").select("id, reservation_id, payment_id").not("payment_id", "is", null).order("id").range(from, to), { strict: true }),
    readAll<InvestorRow>((from, to) => supabase.from("investors").select("id, house").order("id").range(from, to), { strict: true }),
    readAll<AllocationRow>((from, to) => supabase.from("investor_allocations").select("id, investor_id, vehicle_id, share_bps, revenue_share_bps, effective_from, effective_to, compensation").order("id").range(from, to), { strict: true }),
    readAll<OwnerEntry>((from, to) => supabase.from("investor_ledger_entries").select("id, investor_id, type, bucket, amount_cents, reservation_id, vehicle_id, statement_id, reversal_of, metadata, created_at").order("created_at").order("id").range(from, to), { maxRows: 200000, strict: true }),
    readAll<{ id: string; month: string }>((from, to) => supabase.from("investor_mileage_statements").select("id, month").order("id").range(from, to), { strict: true }),
    readAll<ExpenseRow>((from, to) => supabase.from("expenses").select("id, spent_on, category, amount_cents, vehicle_id, voided_at, location_id, service_from, service_to, capital, paid_from").order("id").range(from, to), { maxRows: 100000, strict: true }),
    readAll<ResolutionRow>((from, to) => supabase.from("fin_order_resolutions").select("id, reservation_id, category, amount_cents, approved_by, voided_at, created_at").eq("book", book).order("id").range(from, to), { strict: true }),
    readAll<SettlementRow>((from, to) => supabase.from("fin_settlements").select("id, kind, paid_on, amount_cents, voided_at").order("id").range(from, to), { strict: true }),
  ]);

  const orderById = new Map(orders.map((order) => [order.id, order]));
  const postedOrderIds = new Set(posted.filter((row) => row.source_key.startsWith("order:")).map((row) => row.source_id));
  const linesFor = orders.filter((order) => postable.has(order.status) || postedOrderIds.has(order.id)).map((order) => order.id);
  const lineRows = await inChunks(linesFor, async (part) => readAll<LineRow>((from, to) => supabase.from("reservation_line_items").select("id, reservation_id, type, code, amount_cents, created_at").in("reservation_id", part).order("id").range(from, to), { strict: true }));
  const linesByOrder = new Map<string, OrderLine[]>();
  for (const line of lineRows) linesByOrder.set(line.reservation_id, [...(linesByOrder.get(line.reservation_id) ?? []), line]);

  const result: EngineResult = { book, orders: 0, built: 0, unchanged: 0, toPost: 0, posted: 0, reversals: 0, failed: 0, gateSkipped: 0, issues: 0, stopped: false };
  if (Date.now() >= options.deadline) return { ...result, stopped: true };

  const lineMappings = activeMappings(mappings, "LINE", today);
  const expenseMappings = activeMappings(mappings, "EXPENSE", today);
  const overrides = new Map(inclusionRows.map((row) => [`${row.object_type}:${row.object_id}`, row.included]));
  const intents = liveIntents(txns);
  const paymentsByOrder = new Map<string, PaymentRow[]>();
  for (const payment of payments) paymentsByOrder.set(payment.reservation_id, [...(paymentsByOrder.get(payment.reservation_id) ?? []), payment]);
  const paymentById = new Map(payments.map((payment) => [payment.id, payment]));
  const paymentByIntent = new Map(payments.filter((payment) => payment.stripe_payment_intent_id).map((payment) => [payment.stripe_payment_intent_id as string, payment]));
  const intentOfPayment = new Map(payments.filter((payment) => payment.stripe_payment_intent_id).map((payment) => [payment.id, payment.stripe_payment_intent_id as string]));
  const investorById = new Map(investors.map((investor) => [investor.id, investor]));
  const investorIn = (id: string) => {
    const investor = investorById.get(id);
    return investor ? investorIncluded({ house: investor.house, override: overrides.get(`investor:${id}`) ?? null }) : false;
  };

  const inclusionCache = new Map<string, Inclusion>();
  const inclusionOf = (order: OrderRow): Inclusion => {
    const cached = inclusionCache.get(order.id);
    if (cached) return cached;
    const liveStripe = (paymentsByOrder.get(order.id) ?? []).some((payment) => payment.stripe_payment_intent_id && intents.has(payment.stripe_payment_intent_id));
    const value = orderInclusion({ test: testOrderOf(order), liveStripe, override: overrides.get(`reservation:${order.id}`) ?? null });
    inclusionCache.set(order.id, value);
    return value;
  };
  const tagOf = (order: OrderRow) => ({ reservationId: order.id, included: inclusionOf(order) === "included", vehicleId: order.assigned_vehicle_id, locationId: order.pickup_location_id });

  const settlementOf = new Map<string, { feeCents: number; uncollectedCents: number }>();
  for (const row of audits) {
    if (row.action === "payment.dispute_lost" || !row.entity_id) continue;
    settlementOf.set(row.entity_id, { feeCents: Number(row.metadata?.feeCents ?? 0), uncollectedCents: Number(row.metadata?.uncollectedCents ?? 0) });
  }
  const damages = damageNets(claims, intentOfPayment, txns);
  const shares = ledgerShareByOrder(entries);

  const builts: Built[] = [];
  const issues: Issue[] = [];
  const builtOrders = new Set<string>();
  const ready: OrderFacts[] = [];
  for (const order of orders) {
    if (!postable.has(order.status) && !postedOrderIds.has(order.id)) continue;
    const inclusion = inclusionOf(order);
    const pending = pendingInclusionIssue({ id: order.id, number: order.number, status: order.status, actualPickupAt: order.actual_pickup_at }, inclusion, now);
    if (pending) issues.push(pending);
    if (inclusion !== "included") {
      if (postedOrderIds.has(order.id)) issues.push({ kind: "inclusion_changed", dedupeKey: `inclusion_changed:${order.id}`, reservationId: order.id, detail: { number: order.number, inclusion } });
      continue;
    }
    const lines = linesByOrder.get(order.id) ?? [];
    const gate = checkGate({ status: order.status, totalCents: order.total_cents, updatedAtBefore: order.updated_at, updatedAtAfter: order.updated_at, lines, now });
    if (!gate.ok) {
      result.gateSkipped += 1;
      if (gate.reason !== "changed_while_reading" && gate.reason !== "recently_changed") issues.push({ kind: "gate_failed", dedupeKey: `gate_failed:${order.id}:${gate.reason}`, reservationId: order.id, detail: { number: order.number, reason: gate.reason } });
      continue;
    }
    const allocation = vehicleAllocation(order.assigned_vehicle_id, allocations, today);
    const investor = allocation ? investorById.get(allocation.investor_id) ?? null : null;
    const owner =
      allocation && investor && !investor.house
        ? { investorId: investor.id, eligible: (allocation.compensation ?? "REVENUE_SHARE") === "REVENUE_SHARE" && investorIn(investor.id), revenueShareBps: allocation.revenue_share_bps, shareBps: allocation.share_bps, ledgerCents: shares.get(`${investor.id}:${order.id}`) ?? null }
        : null;
    ready.push({
      id: order.id,
      number: order.number,
      status: order.status,
      actualPickupAt: order.actual_pickup_at,
      returnAt: order.return_at,
      actualReturnAt: order.actual_return_at,
      cancelledAt: order.cancelled_at,
      completedAt: order.completed_at,
      vehicleId: order.assigned_vehicle_id,
      locationId: order.pickup_location_id,
      lines,
      settlement: settlementOf.get(order.id) ?? null,
      damages: damages.filter((damage) => damage.reservationId === order.id),
      companyVehicle: !investor || investor.house,
      owner,
    });
  }
  const histories = await loadHistories(supabase, ready.filter((facts) => facts.actualPickupAt !== null).map((facts) => facts.id));
  for (const facts of ready) {
    const returnedAt = facts.status === "COMPLETED" && facts.actualReturnAt ? Date.parse(facts.actualReturnAt) : null;
    const history = facts.actualPickupAt ? priceHistory({ snapshots: histories.get(facts.id) ?? [], currentLines: facts.lines, currentReturnAt: facts.returnAt, returnedAt }) : undefined;
    builts.push(orderTargets({ ...facts, history }, { mappings: lineMappings, now }));
    builtOrders.add(facts.id);
  }
  result.orders = builtOrders.size;

  for (const txn of txns) {
    const payment = txn.payment_intent_id ? paymentByIntent.get(txn.payment_intent_id) : undefined;
    const order = payment ? orderById.get(payment.reservation_id) : undefined;
    builts.push(stripeTargets(txn, order ? tagOf(order) : null));
  }
  for (const payout of payouts) builts.push(payoutArrivalTargets(payout));
  const lostDisputes = new Map<string, { disputeId: string; amountCents: number; at: string; reservationId: string | null }>();
  for (const row of audits) {
    if (row.action !== "payment.dispute_lost") continue;
    const payment = typeof row.metadata?.paymentId === "string" ? paymentById.get(row.metadata.paymentId) : undefined;
    const intent = payment?.stripe_payment_intent_id ?? (row.entity_type === "payment_intent" ? row.entity_id : null);
    const disputeId = typeof row.metadata?.disputeId === "string" ? row.metadata.disputeId : null;
    if (!disputeId || !intent || !intents.has(intent) || lostDisputes.has(disputeId)) continue;
    lostDisputes.set(disputeId, { disputeId, amountCents: Number(row.metadata?.amountCents ?? 0), at: row.created_at, reservationId: payment?.reservation_id ?? null });
  }
  for (const lost of lostDisputes.values()) builts.push(disputeLostTargets(lost));
  for (const payment of payments) {
    const order = orderById.get(payment.reservation_id);
    if (!payment.offline_method || !order || inclusionOf(order) === "pending") continue;
    builts.push(offlinePaymentTargets(payment, tagOf(order)));
  }
  for (const refund of refunds) {
    const payment = paymentById.get(refund.payment_id);
    const order = payment ? orderById.get(payment.reservation_id) : undefined;
    if (!refund.offline_method || !order || inclusionOf(order) === "pending") continue;
    builts.push(offlineRefundTargets(refund, tagOf(order)));
  }
  const original = ownerOriginals(entries);
  const fromEarnings = withdrawalsFromEarnings(entries);
  const statementMonth = new Map(statements.map((statement) => [statement.id, statement.month]));
  for (const entry of entries) {
    const included = investorIn(entry.investor_id);
    const order = entry.reservation_id ? orderById.get(entry.reservation_id) : undefined;
    if (included && order && inclusionOf(order) !== "included" && ownerEntryShape(entry, original(entry)) === "share") {
      issues.push({ kind: "owner_share_unbooked_order", dedupeKey: `owner_share_unbooked_order:${entry.id}`, reservationId: order.id, investorId: entry.investor_id, detail: { entry: entry.id, number: order.number, amountCents: entry.amount_cents } });
    }
    builts.push(ownerLedgerTargets(entry, { included, original: original(entry), statementMonth: entry.statement_id ? statementMonth.get(entry.statement_id) ?? null : null, fromEarningsCents: fromEarnings.get(entry.id) }));
  }
  for (const expense of expenses) builts.push(expenseTargets(expense, expenseMappings, today));
  for (const row of settlements) builts.push(settlementTargets(row));
  for (const row of resolutions) {
    const order = orderById.get(row.reservation_id);
    builts.push(resolutionTargets(row, { reservationId: row.reservation_id, vehicleId: order?.assigned_vehicle_id ?? null, locationId: order?.pickup_location_id ?? null }));
  }

  let items: PostingItem[] = builts.flatMap((built) => built.items);
  issues.push(...builts.flatMap((built) => built.issues));

  if (builtOrders.size > 0) {
    const fresh = await inChunks([...builtOrders], async (part) => {
      const { data, error } = await supabase.from("reservations").select("id, updated_at").in("id", part);
      if (error) throw new Error(`finance_query_failed: ${error.message}`);
      return (data ?? []) as Array<{ id: string; updated_at: string }>;
    });
    const freshById = new Map(fresh.map((row) => [row.id, row.updated_at]));
    const moved = new Set([...builtOrders].filter((id) => freshById.get(id) !== orderById.get(id)?.updated_at));
    if (moved.size > 0) {
      for (const id of moved) builtOrders.delete(id);
      items = items.filter((entry) => !(entry.source_type === "reservation" && moved.has(entry.source_id)));
      result.gateSkipped += moved.size;
    }
  }
  result.built = items.length;

  const ids = (rows: Array<{ id: string }>) => new Set(rows.map((row) => row.id));
  const existing: Record<string, Set<string>> = {
    stripe_txn: ids(txns),
    stripe_payout: ids(payouts),
    payment: ids(payments),
    refund: ids(refunds),
    investor_ledger: ids(entries),
    expense: ids(expenses),
    resolution: ids(resolutions),
    settlement: ids(settlements),
  };
  const plan = planPostings({
    built: items,
    posted,
    today,
    reversible: (key, sourceId) => {
      if (key.startsWith("order:")) return !orderById.has(sourceId) || builtOrders.has(sourceId);
      const known = existing[sourceTypeOfKey(key)];
      return known ? !known.has(sourceId) : false;
    },
  });
  result.unchanged = plan.unchanged;
  result.reversals = plan.reversals;
  result.toPost = plan.toPost.length;

  for (const batch of chunk(plan.toPost, 50)) {
    if (Date.now() >= options.deadline) {
      result.stopped = true;
      break;
    }
    const { data, error } = await supabase.rpc("fin_post_targets", { p_book: book, p_live_key: options.liveKey, p_items: batch });
    if (error) throw new Error(`fin_post_targets: ${error.message}`);
    for (const row of (data ?? []) as Array<{ source_key: string; posted: boolean; error: string | null }>) {
      if (row.posted) result.posted += 1;
      if (row.error) {
        result.failed += 1;
        issues.push({ kind: "posting_failed", dedupeKey: `posting_failed:${row.source_key}`, sourceKey: row.source_key, detail: { error: row.error } });
      }
    }
  }

  const unique = [...new Map(issues.map((issue) => [issue.dedupeKey, issue])).values()];
  result.issues = unique.length;
  for (const part of chunk(unique, 200)) {
    const { error } = await supabase.from("fin_exceptions").upsert(
      part.map((issue) => ({ book, kind: issue.kind, dedupe_key: issue.dedupeKey, reservation_id: issue.reservationId ?? null, investor_id: issue.investorId ?? null, source_key: issue.sourceKey ?? null, detail: issue.detail ?? {} })),
      { onConflict: "book,dedupe_key", ignoreDuplicates: true },
    );
    if (error) throw new Error(`fin_exceptions: ${error.message}`);
  }
  return result;
}
