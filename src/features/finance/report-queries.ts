import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadFinance } from "./queries";
import { buildStatement, monthRange, netOfTax, type CostItem, type ExpenseCategory, type ReportLine, type Statement } from "./report";
import { liveStripeFees } from "./stripe-sync";

const closed = ["CANCELLED", "NO_SHOW", "EXPIRED"];
const earning = ["CONFIRMED", "ACTIVE", "COMPLETED"];

export type VehicleLine = { vehicle_id: string; fleet_number: string; orders: number; days: number; revenueCents: number; payableCents: number; costCents: number; contributionCents: number; utilization: number };

export type MonthReport = { month: string; statement: Statement; orders: number; collectedCents: number; outstandingCents: number; vehicles: VehicleLine[] };

function chunks<T>(items: T[], size = 50) {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size));
  return result;
}

export async function loadMonthReport(month: string): Promise<MonthReport> {
  const supabase = createAdminClient();
  const range = monthRange(month);
  const [{ rows }, { data: expenseRows }, { data: serviceRows }, stripeFeeCents] = await Promise.all([
    loadFinance({ from: range.from, to: range.to }),
    supabase.from("expenses").select("category, amount_cents, vehicle_id").gte("spent_on", range.from).lte("spent_on", range.to).is("voided_at", null).limit(5000),
    supabase.from("vehicle_service_logs").select("vehicle_id, cost_cents").gte("performed_on", range.from).lte("performed_on", range.to).not("cost_cents", "is", null).limit(5000),
    liveStripeFees(month),
  ]);
  const live = rows.filter((row) => earning.includes(row.status));
  const lines: Array<ReportLine & { reservation_id: string }> = [];
  for (const ids of chunks(live.map((row) => row.id))) {
    const { data } = await supabase.from("reservation_line_items").select("reservation_id, type, code, amount_cents").in("reservation_id", ids);
    lines.push(...((data ?? []) as Array<ReportLine & { reservation_id: string }>));
  }
  const costs: Array<CostItem & { vehicleId: string | null }> = [
    ...((expenseRows ?? []) as Array<{ category: ExpenseCategory; amount_cents: number; vehicle_id: string | null }>).map((row) => ({ category: row.category, amountCents: row.amount_cents, vehicleId: row.vehicle_id })),
    ...((serviceRows ?? []) as Array<{ vehicle_id: string; cost_cents: number }>).map((row) => ({ category: "SERVICE" as const, amountCents: row.cost_cents, vehicleId: row.vehicle_id })),
    ...(stripeFeeCents > 0 ? [{ category: "STRIPE" as const, amountCents: stripeFeeCents, vehicleId: null }] : []),
  ];
  const statement = buildStatement({
    lines,
    cancellationCents: rows.filter((row) => closed.includes(row.status)).reduce((sum, row) => sum + row.paid_cents - row.refunded_cents, 0),
    payableCents: live.reduce((sum, row) => sum + row.payable_cents, 0),
    costs,
  });

  const byReservation = new Map<string, ReportLine[]>();
  for (const line of lines) byReservation.set(line.reservation_id, [...(byReservation.get(line.reservation_id) ?? []), line]);
  const grouped = new Map<string, Omit<VehicleLine, "fleet_number" | "contributionCents" | "utilization">>();
  const entry = (vehicleId: string) => {
    if (!grouped.has(vehicleId)) grouped.set(vehicleId, { vehicle_id: vehicleId, orders: 0, days: 0, revenueCents: 0, payableCents: 0, costCents: 0 });
    return grouped.get(vehicleId)!;
  };
  for (const row of live) {
    if (!row.vehicle_id) continue;
    const item = entry(row.vehicle_id);
    item.orders += 1;
    item.days += row.rental_days;
    item.revenueCents += netOfTax(byReservation.get(row.id) ?? []);
    item.payableCents += row.payable_cents;
  }
  for (const cost of costs) if (cost.vehicleId) entry(cost.vehicleId).costCents += cost.amountCents;
  const names = new Map<string, string>();
  for (const ids of chunks([...grouped.keys()])) {
    const { data } = await supabase.from("vehicles").select("id, fleet_number").in("id", ids);
    for (const vehicle of data ?? []) names.set(vehicle.id as string, vehicle.fleet_number as string);
  }
  const vehicles = [...grouped.values()]
    .map((item) => ({ ...item, fleet_number: names.get(item.vehicle_id) ?? "—", contributionCents: item.revenueCents - item.payableCents - item.costCents, utilization: Math.min(100, Math.round((item.days / range.days) * 100)) }))
    .sort((a, b) => b.contributionCents - a.contributionCents);

  return {
    month,
    statement,
    orders: live.length,
    collectedCents: rows.reduce((sum, row) => sum + row.paid_cents - row.refunded_cents, 0),
    outstandingCents: live.reduce((sum, row) => sum + Math.max(0, row.total_cents - (row.paid_cents - row.refunded_cents)), 0),
    vehicles,
  };
}

export type Balances = { prepaidCents: number; ownerPayableCents: number };

export async function loadBalances(): Promise<Balances> {
  const supabase = createAdminClient();
  const [{ data: upcoming }, { data: investors }, { data: balances }] = await Promise.all([
    supabase.from("reservations").select("id, payments:payments(kind, status, amount_captured_cents, amount_refunded_cents)").eq("status", "CONFIRMED").gt("pickup_at", new Date().toISOString()).limit(2000),
    supabase.from("investors").select("id").eq("house", false),
    supabase.from("investor_balances").select("investor_id, available_cents, pending_cents"),
  ]);
  const partners = new Set((investors ?? []).map((row) => row.id as string));
  const prepaidCents = ((upcoming ?? []) as unknown as Array<{ payments: Array<{ kind: string; status: string; amount_captured_cents: number; amount_refunded_cents: number }> }>).reduce(
    (sum, row) => sum + row.payments.filter((payment) => payment.kind !== "SECURITY_HOLD" && ["SUCCEEDED", "PARTIALLY_REFUNDED", "REFUNDED"].includes(payment.status)).reduce((inner, payment) => inner + payment.amount_captured_cents - payment.amount_refunded_cents, 0),
    0,
  );
  const ownerPayableCents = (balances ?? []).filter((row) => partners.has(row.investor_id as string)).reduce((sum, row) => sum + (row.available_cents ?? 0) + (row.pending_cents ?? 0), 0);
  return { prepaidCents, ownerPayableCents };
}
