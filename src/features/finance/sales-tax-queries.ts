import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { zonedParts } from "@/features/booking/time";
import { rangeBounds } from "./queries";
import { orderTax, summarizeTax, type Collected, type TaxLine, type TaxOrder, type TaxPeriod, type TaxRow } from "./sales-tax";

const closed = ["CANCELLED", "NO_SHOW", "EXPIRED"];
const earning = ["CONFIRMED", "ACTIVE", "COMPLETED"];
const settled = ["SUCCEEDED", "PARTIALLY_REFUNDED", "REFUNDED"];
const pageSize = 500;
const zone = "America/Los_Angeles";

type Row = {
  id: string;
  number: string;
  status: string;
  pickup_at: string;
  tax_rate_bps: number | null;
  taxable_cents: number | null;
  pickup_location_id: string;
  location: { code: string; name: string; name_zh: string | null } | null;
  customer: { full_name: string } | null;
  payments: Array<{ kind: string; status: string; amount_captured_cents: number; amount_refunded_cents: number; refunds: Array<{ status: string; created_at: string }> }>;
  lines: Array<TaxLine & { created_at: string }>;
};

export type TaxDetail = TaxOrder & { id: string; number: string; status: string; pickup_at: string; pickupDate: string; changedDate: string; customer: string; locationId: string; locationCode: string; location: string; rateBps: number; paidCents: number; refundedCents: number };

export type SalesTaxReport = { orders: TaxDetail[]; rows: TaxRow[]; total: ReturnType<typeof summarizeTax>["total"]; cancelled: number; cancellationCents: number; truncated: boolean };

export async function loadSalesTax(period: Pick<TaxPeriod, "from" | "to">, locale: string): Promise<SalesTaxReport> {
  const supabase = createAdminClient();
  const { start, end } = rangeBounds({ from: period.from, to: period.to });
  const raw: Row[] = [];
  let truncated = false;
  for (let offset = 0; ; offset += pageSize) {
    if (offset >= 40000) {
      truncated = true;
      break;
    }
    const { data, error } = await supabase
      .from("reservations")
      .select(
        "id, number, status, pickup_at, tax_rate_bps, taxable_cents, pickup_location_id, location:locations!reservations_pickup_location_id_fkey(code, name, name_zh), customer:customers(full_name), payments:payments(kind, status, amount_captured_cents, amount_refunded_cents, refunds:refunds(status, created_at)), lines:reservation_line_items(type, code, amount_cents, taxable, created_at)",
      )
      .gte("pickup_at", start)
      .lt("pickup_at", end)
      .in("status", [...earning, ...closed])
      .order("pickup_at")
      .order("id")
      .range(offset, offset + pageSize - 1);
    if (error) throw new Error("sales_tax_unavailable");
    const page = (data ?? []) as unknown as Row[];
    raw.push(...page);
    if (page.length < pageSize) break;
  }

  const money = (row: Row, keep: (kind: string) => boolean): Collected => {
    const paid = row.payments.filter((payment) => settled.includes(payment.status) && keep(payment.kind));
    return { paidCents: paid.reduce((sum, payment) => sum + payment.amount_captured_cents, 0), refundedCents: paid.reduce((sum, payment) => sum + payment.amount_refunded_cents, 0) };
  };
  const changed = (row: Row) => [...row.lines.map((line) => line.created_at), ...row.payments.flatMap((payment) => payment.refunds.filter((refund) => refund.status === "SUCCEEDED").map((refund) => refund.created_at))].reduce((latest, value) => (value > latest ? value : latest), "");
  const orders: TaxDetail[] = raw
    .filter((row) => earning.includes(row.status))
    .map((row) => {
      const rental = money(row, (kind) => kind === "RENTAL");
      const other = money(row, (kind) => kind !== "RENTAL");
      const rateBps = Number(row.tax_rate_bps ?? 0);
      const last = changed(row);
      return {
        id: row.id,
        number: row.number,
        status: row.status,
        pickup_at: row.pickup_at,
        pickupDate: zonedParts(row.pickup_at, zone).date,
        changedDate: last ? zonedParts(last, zone).date : "",
        customer: row.customer?.full_name ?? "",
        locationId: row.pickup_location_id,
        locationCode: row.location?.code ?? "",
        location: (locale === "zh" ? (row.location?.name_zh ?? row.location?.name) : row.location?.name) ?? "—",
        rateBps,
        paidCents: rental.paidCents + other.paidCents,
        refundedCents: rental.refundedCents + other.refundedCents,
        ...orderTax({ rateBps, taxableCents: row.taxable_cents ?? 0, lines: row.lines, rental, other }),
      };
    });
  const kept = raw.filter((row) => closed.includes(row.status)).map((row) => money(row, (kind) => kind !== "SECURITY_HOLD")).map((item) => item.paidCents - item.refundedCents);
  return { orders, ...summarizeTax(orders), cancelled: kept.filter((cents) => cents !== 0).length, cancellationCents: kept.reduce((sum, cents) => sum + cents, 0), truncated };
}
