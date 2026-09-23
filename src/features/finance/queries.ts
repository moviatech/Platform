import "server-only";
import { zonedParts, zonedToUtc } from "@/features/booking/time";
import { createAdminClient } from "@/lib/supabase/admin";

const zone = "America/Los_Angeles";
const closed = ["CANCELLED", "NO_SHOW", "EXPIRED"];

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
};

export type FinanceSummary = {
  count: number;
  receivableCents: number;
  collectedCents: number;
  refundedCents: number;
  taxCents: number;
  holdCents: number;
  pendingReview: number;
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

type Row = Omit<FinanceRow, "paid_cents" | "refunded_cents"> & { payments: Array<{ kind: string; status: string; amount_captured_cents: number; amount_refunded_cents: number }> };

export async function loadFinance(range: FinanceRange): Promise<{ rows: FinanceRow[]; summary: FinanceSummary }> {
  const supabase = createAdminClient();
  const { start, end } = rangeBounds(range);
  const [{ data }, { data: holds }] = await Promise.all([
    supabase
      .from("reservations")
      .select("id, number, status, pickup_at, total_cents, tax_cents, payment_state, price_reviewed_at, customer:customers(full_name), payments:payments(kind, status, amount_captured_cents, amount_refunded_cents)")
      .gte("pickup_at", start)
      .lt("pickup_at", end)
      .order("pickup_at"),
    supabase.from("payments").select("amount_cents").eq("kind", "SECURITY_HOLD").eq("status", "AUTHORIZED"),
  ]);
  const rows: FinanceRow[] = ((data ?? []) as unknown as Row[]).map((row) => {
    const money = row.payments.filter((payment) => payment.kind !== "SECURITY_HOLD" && ["SUCCEEDED", "PARTIALLY_REFUNDED", "REFUNDED"].includes(payment.status));
    return {
      ...row,
      paid_cents: money.reduce((sum, payment) => sum + payment.amount_captured_cents, 0),
      refunded_cents: money.reduce((sum, payment) => sum + payment.amount_refunded_cents, 0),
    };
  });
  const live = rows.filter((row) => !closed.includes(row.status));
  const summary: FinanceSummary = {
    count: rows.length,
    receivableCents: live.reduce((sum, row) => sum + row.total_cents, 0),
    collectedCents: rows.reduce((sum, row) => sum + row.paid_cents - row.refunded_cents, 0),
    refundedCents: rows.reduce((sum, row) => sum + row.refunded_cents, 0),
    taxCents: live.reduce((sum, row) => sum + row.tax_cents, 0),
    holdCents: (holds ?? []).reduce((sum, payment) => sum + payment.amount_cents, 0),
    pendingReview: live.filter((row) => !row.price_reviewed_at).length,
  };
  return { rows, summary };
}

export type PaymentExportRow = { id: string; kind: string; status: string; amount_cents: number; amount_captured_cents: number; amount_refunded_cents: number; created_at: string; stripe_payment_intent_id: string | null; reservation: { number: string } | null };

export async function listPaymentsForExport(range: FinanceRange): Promise<PaymentExportRow[]> {
  const { start, end } = rangeBounds(range);
  const { data } = await createAdminClient()
    .from("payments")
    .select("id, kind, status, amount_cents, amount_captured_cents, amount_refunded_cents, created_at, stripe_payment_intent_id, reservation:reservations(number)")
    .gte("created_at", start)
    .lt("created_at", end)
    .order("created_at");
  return (data ?? []) as unknown as PaymentExportRow[];
}

export type VehicleReportRow = { vehicle_id: string; fleet_number: string; rentals: number; days: number; revenue_cents: number; utilization: number };

export async function loadVehicleReport(range: FinanceRange): Promise<VehicleReportRow[]> {
  const { start, end } = rangeBounds(range);
  const { data } = await createAdminClient()
    .from("reservations")
    .select("assigned_vehicle_id, rental_days, total_cents, status, vehicle:vehicles!reservations_assigned_vehicle_id_fkey(fleet_number)")
    .gte("pickup_at", start)
    .lt("pickup_at", end)
    .in("status", ["CONFIRMED", "ACTIVE", "COMPLETED"]);
  const spanDays = Math.max(1, Math.round((new Date(end).getTime() - new Date(start).getTime()) / 86400000));
  const grouped = new Map<string, VehicleReportRow>();
  for (const row of (data ?? []) as unknown as Array<{ assigned_vehicle_id: string | null; rental_days: number; total_cents: number; vehicle: { fleet_number: string } | null }>) {
    if (!row.assigned_vehicle_id) continue;
    const entry = grouped.get(row.assigned_vehicle_id) ?? { vehicle_id: row.assigned_vehicle_id, fleet_number: row.vehicle?.fleet_number ?? "—", rentals: 0, days: 0, revenue_cents: 0, utilization: 0 };
    entry.rentals += 1;
    entry.days += row.rental_days;
    entry.revenue_cents += row.total_cents;
    grouped.set(row.assigned_vehicle_id, entry);
  }
  return [...grouped.values()].map((entry) => ({ ...entry, utilization: Math.min(100, Math.round((entry.days / spanDays) * 100)) })).sort((a, b) => b.revenue_cents - a.revenue_cents);
}
