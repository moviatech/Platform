import "server-only";
import { zonedParts, zonedToUtc } from "@/features/booking/time";
import { rateFor } from "@/features/investor/mileage";
import { computeShareBase, coveringAllocation, shareOf, type ShareLine } from "@/features/investor/share-math";
import { createAdminClient } from "@/lib/supabase/admin";
import { financeBook } from "./ledger/engine";
import { readAll } from "./paging";
import { reviewedAt, type PriceReview, type ReviewLine } from "./price-review";
import { rowRetention, summarizeRetention, type Ownership, type RetentionSummary } from "./retention";
import { testOrderColumns, testOrderOf, type TestOrderRow } from "./test-orders";

const zone = "America/Los_Angeles";
const closed = ["CANCELLED", "NO_SHOW", "EXPIRED"];
const earning = ["CONFIRMED", "ACTIVE", "COMPLETED"];

export type FinanceRange = { from: string; to: string };

export type FinanceRow = {
  id: string;
  number: string;
  status: string;
  pickup_at: string;
  total_cents: number;
  tax_cents: number;
  payment_state: string;
  price_reviewed_at: string | null;
  customer: { full_name: string } | null;
  paid_cents: number;
  refunded_cents: number;
  ownership: Ownership;
  payable_cents: number;
  retained_cents: number;
  vehicle_id: string | null;
  rental_days: number;
  balance_cents: number | null;
};

export type FinanceSummary = {
  count: number;
  receivableCents: number;
  collectedCents: number;
  refundedCents: number;
  taxCents: number;
  holdCents: number;
  pendingReview: number;
  excludedTests: number;
  retention: RetentionSummary;
};

const isoDate = /^\d{4}-\d{2}-\d{2}$/;

export function defaultRange(): FinanceRange {
  const today = zonedParts(new Date(), zone).date;
  return { from: `${today.slice(0, 7)}-01`, to: today };
}

export function parseRange(search: Record<string, string | string[] | undefined>): FinanceRange {
  const fallback = defaultRange();
  const pick = (value: string | string[] | undefined, alt: string) => (typeof value === "string" && isoDate.test(value) ? value : alt);
  const from = pick(search.from, fallback.from);
  const to = pick(search.to, fallback.to);
  return from <= to ? { from, to } : { from: to, to: from };
}

export function rangeBounds(range: FinanceRange) {
  return { start: zonedToUtc(range.from, "00:00", zone).toISOString(), end: new Date(zonedToUtc(range.to, "23:59", zone).getTime() + 60000).toISOString() };
}

type Row = Omit<FinanceRow, "paid_cents" | "refunded_cents" | "ownership" | "payable_cents" | "retained_cents" | "vehicle_id"> &
  TestOrderRow & {
    assigned_vehicle_id: string | null;
    return_at: string;
    completed_at: string | null;
    actual_return_at: string | null;
    start_odometer: number | null;
    end_odometer: number | null;
    payments: Array<{ kind: string; status: string; amount_captured_cents: number; amount_refunded_cents: number }>;
  };

const reservationColumns = `id, number, status, pickup_at, return_at, completed_at, actual_return_at, assigned_vehicle_id, start_odometer, end_odometer, rental_days, total_cents, tax_cents, payment_state, price_reviewed_at, customer:customers(full_name), payments:payments(kind, status, amount_captured_cents, amount_refunded_cents), ${testOrderColumns}`;

type Span = { id: string; vehicle_id: string; investor_id: string; compensation: string; share_bps: number; revenue_share_bps: number; effective_from: string; effective_to: string | null; investor: { house: boolean } | null };

function chunks<T>(items: T[], size = 50) {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size));
  return result;
}

async function ownerPayables(rows: Row[]): Promise<Map<string, { ownership: Ownership; payableCents: number }>> {
  const supabase = createAdminClient();
  const result = new Map<string, { ownership: Ownership; payableCents: number }>();
  const spans = new Map<string, Span[]>();
  for (const ids of chunks([...new Set(rows.map((row) => row.assigned_vehicle_id).filter((id): id is string => Boolean(id)))])) {
    const { data } = await supabase.from("investor_allocations").select("id, vehicle_id, investor_id, compensation, share_bps, revenue_share_bps, effective_from, effective_to, investor:investors(house)").in("vehicle_id", ids);
    for (const span of (data ?? []) as unknown as Span[]) spans.set(span.vehicle_id, [...(spans.get(span.vehicle_id) ?? []), span]);
  }
  const posted = new Map<string, number>();
  for (const ids of chunks(rows.map((row) => row.id))) {
    const { data } = await supabase.from("investor_ledger_entries").select("reservation_id, amount_cents, investor:investors(house)").in("reservation_id", ids).in("type", ["RENTAL_SHARE", "ADJUSTMENT", "REVERSAL"]);
    for (const entry of (data ?? []) as unknown as Array<{ reservation_id: string; amount_cents: number; investor: { house: boolean } | null }>) {
      if (entry.investor?.house) continue;
      posted.set(entry.reservation_id, (posted.get(entry.reservation_id) ?? 0) + entry.amount_cents);
    }
  }
  const expected: Array<{ row: Row; span: Span }> = [];
  const rates = new Map<string, number>();
  for (const row of rows) {
    const date = zonedParts(row.status === "COMPLETED" ? (row.completed_at ?? row.actual_return_at ?? row.return_at) : row.return_at, zone).date;
    const span = row.assigned_vehicle_id ? coveringAllocation(spans.get(row.assigned_vehicle_id) ?? [], date) : null;
    const partner = Boolean(span && !span.investor?.house);
    if (posted.has(row.id)) {
      result.set(row.id, { ownership: "PARTNER", payableCents: posted.get(row.id) ?? 0 });
      continue;
    }
    result.set(row.id, { ownership: partner ? "PARTNER" : "OWN", payableCents: 0 });
    if (!partner || !span || !earning.includes(row.status)) continue;
    if (span.compensation === "PER_MILE") {
      if (row.start_odometer === null || row.end_odometer === null) continue;
      const month = date.slice(0, 7);
      const key = span.investor_id + ":" + month;
      if (!rates.has(key)) rates.set(key, await rateFor(span.investor_id, month));
      result.set(row.id, { ownership: "PARTNER", payableCents: Math.max(0, row.end_odometer - row.start_odometer) * (rates.get(key) ?? 0) });
    } else expected.push({ row, span });
  }
  const lines = new Map<string, ShareLine[]>();
  for (const ids of chunks(expected.map((item) => item.row.id))) {
    const { data } = await supabase.from("reservation_line_items").select("reservation_id, type, code, amount_cents").in("reservation_id", ids);
    for (const line of (data ?? []) as Array<ShareLine & { reservation_id: string }>) lines.set(line.reservation_id, [...(lines.get(line.reservation_id) ?? []), line]);
  }
  for (const { row, span } of expected) result.set(row.id, { ownership: "PARTNER", payableCents: shareOf(computeShareBase(lines.get(row.id) ?? []).baseCents, span.revenue_share_bps, span.share_bps) });
  return result;
}

async function loadReviewState(ids: string[]) {
  const supabase = createAdminClient();
  const reviews = new Map<string, PriceReview>();
  const lines = new Map<string, ReviewLine[]>();
  const balances = new Map<string, number>();
  if (ids.length === 0) return { reviews, lines, balances };
  for (let index = 0; index < ids.length; index += 100) {
    const part = ids.slice(index, index + 100);
    const [reviewRows, lineRows] = await Promise.all([
      readAll<PriceReview & { reservation_id: string }>((from, to) => supabase.from("fin_price_reviews").select("reservation_id, total_cents, lines_hash, reviewed_at").in("reservation_id", part).order("reservation_id").range(from, to)),
      readAll<ReviewLine & { reservation_id: string }>((from, to) => supabase.from("reservation_line_items").select("reservation_id, type, code, amount_cents").in("reservation_id", part).order("id").range(from, to)),
    ]);
    for (const row of reviewRows) reviews.set(row.reservation_id, row);
    for (const row of lineRows) lines.set(row.reservation_id, [...(lines.get(row.reservation_id) ?? []), row]);
  }
  const wanted = new Set(ids);
  const balanceRows = await readAll<{ reservation_id: string; balance: number }>((from, to) => supabase.rpc("fin_order_balances", { p_book: financeBook(), p_as_of: null }).order("reservation_id").range(from, to), { maxRows: 100000 });
  for (const row of balanceRows) if (wanted.has(row.reservation_id)) balances.set(row.reservation_id, Number(row.balance));
  return { reviews, lines, balances };
}

export async function loadFinance(range: FinanceRange): Promise<{ rows: FinanceRow[]; summary: FinanceSummary }> {
  const supabase = createAdminClient();
  const { start, end } = rangeBounds(range);
  const [fetched, holds] = await Promise.all([
    readAll<Row>((from, to) => supabase.from("reservations").select(reservationColumns).gte("pickup_at", start).lt("pickup_at", end).order("pickup_at").order("id").range(from, to)),
    readAll<{ amount_cents: number; reservation: TestOrderRow | null }>((from, to) => supabase.from("payments").select(`amount_cents, reservation:reservations(number, ${testOrderColumns})`).eq("kind", "SECURITY_HOLD").eq("status", "AUTHORIZED").order("id").range(from, to)),
  ]);
  const raw = fetched.filter((row) => !testOrderOf(row));
  const [payables, reviewState] = await Promise.all([ownerPayables(raw), loadReviewState(raw.map((row) => row.id))]);
  const inputs: Array<Parameters<typeof rowRetention>[0]> = [];
  const rows: FinanceRow[] = raw.map((row) => {
    const money = row.payments.filter((payment) => payment.kind !== "SECURITY_HOLD" && ["SUCCEEDED", "PARTIALLY_REFUNDED", "REFUNDED"].includes(payment.status));
    const paid = money.reduce((sum, payment) => sum + payment.amount_captured_cents, 0);
    const refunded = money.reduce((sum, payment) => sum + payment.amount_refunded_cents, 0);
    const owner = payables.get(row.id) ?? { ownership: "OWN" as Ownership, payableCents: 0 };
    const input = { closed: closed.includes(row.status), totalCents: row.total_cents, taxCents: row.tax_cents, paidCents: paid, refundedCents: refunded, ownership: owner.ownership, payableCents: owner.payableCents };
    inputs.push(input);
    const reviewed = reviewedAt({ totalCents: row.total_cents, lines: reviewState.lines.get(row.id) ?? [], review: reviewState.reviews.get(row.id) ?? null, legacyReviewedAt: row.price_reviewed_at });
    return { id: row.id, number: row.number, status: row.status, pickup_at: row.pickup_at, total_cents: row.total_cents, tax_cents: row.tax_cents, payment_state: row.payment_state, price_reviewed_at: reviewed, customer: row.customer, paid_cents: paid, refunded_cents: refunded, ownership: owner.ownership, payable_cents: owner.payableCents, retained_cents: rowRetention(input).retainedCents, vehicle_id: row.assigned_vehicle_id, rental_days: row.rental_days, balance_cents: reviewState.balances.get(row.id) ?? null };
  });
  const live = rows.filter((row) => !closed.includes(row.status));
  const summary: FinanceSummary = {
    count: rows.length,
    receivableCents: live.reduce((sum, row) => sum + row.total_cents, 0),
    collectedCents: rows.reduce((sum, row) => sum + row.paid_cents - row.refunded_cents, 0),
    refundedCents: rows.reduce((sum, row) => sum + row.refunded_cents, 0),
    taxCents: live.reduce((sum, row) => sum + row.tax_cents, 0),
    holdCents: holds.filter((hold) => !(hold.reservation && testOrderOf(hold.reservation))).reduce((sum, payment) => sum + payment.amount_cents, 0),
    pendingReview: live.filter((row) => !row.price_reviewed_at).length,
    excludedTests: fetched.length - raw.length,
    retention: summarizeRetention(inputs),
  };
  return { rows, summary };
}

export type PaymentExportRow = { id: string; kind: string; status: string; amount_cents: number; amount_captured_cents: number; amount_refunded_cents: number; created_at: string; description: string | null; offline_method: string | null; stripe_payment_intent_id: string | null; stripe_checkout_session_id: string | null; reservation: ({ number: string } & TestOrderRow) | null; refunds: Array<{ status: string; offline_method: string | null }> };

export async function listPaymentsForExport(range: FinanceRange): Promise<PaymentExportRow[]> {
  const { start, end } = rangeBounds(range);
  const supabase = createAdminClient();
  const rows = await readAll<PaymentExportRow>(
    (from, to) =>
      supabase
        .from("payments")
        .select(`id, kind, status, amount_cents, amount_captured_cents, amount_refunded_cents, created_at, description, offline_method, stripe_payment_intent_id, stripe_checkout_session_id, reservation:reservations(number, ${testOrderColumns}), refunds:refunds(status, offline_method)`)
        .gte("created_at", start)
        .lt("created_at", end)
        .order("created_at")
        .order("id")
        .range(from, to),
    { maxRows: 50000 },
  );
  return rows.filter((row) => !(row.reservation && testOrderOf(row.reservation)));
}

export type VehicleReportRow = { vehicle_id: string; fleet_number: string; rentals: number; days: number; revenue_cents: number; utilization: number };

export async function loadVehicleReport(range: FinanceRange): Promise<VehicleReportRow[]> {
  const { start, end } = rangeBounds(range);
  const supabase = createAdminClient();
  const data = await readAll<TestOrderRow & { assigned_vehicle_id: string | null; rental_days: number; total_cents: number }>((from, to) =>
    supabase.from("reservations").select(`number, assigned_vehicle_id, rental_days, total_cents, status, ${testOrderColumns}`).gte("pickup_at", start).lt("pickup_at", end).in("status", ["CONFIRMED", "ACTIVE", "COMPLETED"]).order("pickup_at").order("id").range(from, to),
  );
  const spanDays = Math.max(1, Math.round((new Date(end).getTime() - new Date(start).getTime()) / 86400000));
  const grouped = new Map<string, VehicleReportRow>();
  for (const row of data) {
    if (!row.assigned_vehicle_id || testOrderOf(row)) continue;
    const entry = grouped.get(row.assigned_vehicle_id) ?? { vehicle_id: row.assigned_vehicle_id, fleet_number: row.vehicle?.fleet_number ?? "—", rentals: 0, days: 0, revenue_cents: 0, utilization: 0 };
    entry.rentals += 1;
    entry.days += row.rental_days;
    entry.revenue_cents += row.total_cents;
    grouped.set(row.assigned_vehicle_id, entry);
  }
  return [...grouped.values()].map((entry) => ({ ...entry, utilization: Math.min(100, Math.round((entry.days / spanDays) * 100)) })).sort((a, b) => b.revenue_cents - a.revenue_cents);
}
