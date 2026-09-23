import { taxAt } from "../pricing/quote";
import { lineGroup, netOfTax, type ReportLine } from "./report";

export const periodKinds = ["month", "quarter", "year"] as const;
export type PeriodKind = (typeof periodKinds)[number];

export type TaxPeriod = { key: string; kind: PeriodKind; from: string; to: string; previous: string; next: string };

export const firstPeriodDate = "2020-01-01";

const pad = (value: number) => String(value).padStart(2, "0");
const lastDay = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate();

function build(kind: PeriodKind, year: number, index: number): TaxPeriod {
  if (kind === "year") return { key: String(year), kind, from: `${year}-01-01`, to: `${year}-12-31`, previous: String(year - 1), next: String(year + 1) };
  const size = kind === "quarter" ? 4 : 12;
  const span = 12 / size;
  const name = (y: number, i: number) => {
    const shifted = y * size + i;
    const yy = Math.floor(shifted / size);
    const ii = shifted - yy * size;
    return kind === "quarter" ? `${yy}-Q${ii + 1}` : `${yy}-${pad(ii + 1)}`;
  };
  const first = index * span + 1;
  const last = first + span - 1;
  return { key: name(year, index), kind, from: `${year}-${pad(first)}-01`, to: `${year}-${pad(last)}-${pad(lastDay(year, last))}`, previous: name(year, index - 1), next: name(year, index + 1) };
}

export function periodOf(kind: PeriodKind, date: string): TaxPeriod {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  return build(kind, year, kind === "year" ? 0 : kind === "quarter" ? Math.floor((month - 1) / 3) : month - 1);
}

export function parsePeriod(value: unknown, today: string): TaxPeriod {
  const text = typeof value === "string" ? value : "";
  const month = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(text);
  const quarter = /^(\d{4})-Q([1-4])$/.exec(text);
  const year = /^(\d{4})$/.exec(text);
  const valid = (y: string) => Number(y) >= Number(firstPeriodDate.slice(0, 4)) && Number(y) <= 2100;
  if (month && valid(month[1])) return build("month", Number(month[1]), Number(month[2]) - 1);
  if (quarter && valid(quarter[1])) return build("quarter", Number(quarter[1]), Number(quarter[2]) - 1);
  if (year && valid(year[1])) return build("year", Number(year[1]), 0);
  return periodOf("quarter", today);
}

export function switchPeriod(period: TaxPeriod, kind: PeriodKind, today: string): TaxPeriod {
  if (kind === period.kind) return period;
  const anchor = today >= period.from && today <= period.to ? today : period.from;
  return periodOf(kind, anchor);
}

export type TaxLine = ReportLine & { taxable: boolean };

export type Collected = { paidCents: number; refundedCents: number };

export type TaxOrderInput = { rateBps: number; taxableCents: number; lines: TaxLine[]; rental: Collected; other: Collected };

export type TaxFigures = { salesCents: number; taxableCents: number; exemptCents: number; taxCents: number; refundTaxCents: number; dueCents: number };

export type TaxOrder = TaxFigures & { expectedCents: number };

const postRental = (line: TaxLine) => line.type === "ADDITIONAL" && !line.code.startsWith("manual.");
const postRentalTaxable = (line: TaxLine) => postRental(line) && line.taxable && line.code !== "fee.tax";
const taxOf = (lines: TaxLine[]) => lines.reduce((sum, line) => (lineGroup(line) === "TAX" ? sum + line.amount_cents : sum), 0);

function refundedTax(lines: TaxLine[], money: Collected) {
  const taxCents = taxOf(lines);
  const billed = lines.reduce((sum, line) => sum + line.amount_cents, 0);
  if (taxCents <= 0 || billed <= 0) return 0;
  const shortfall = Math.max(0, billed - (money.paidCents - money.refundedCents));
  const refundedSale = Math.min(Math.max(0, money.refundedCents), shortfall);
  return Math.min(taxCents, Math.round((taxCents * refundedSale) / billed));
}

export function orderTax(input: TaxOrderInput): TaxOrder {
  const salesCents = netOfTax(input.lines);
  const taxCents = taxOf(input.lines);
  const taxableCents = input.taxableCents + input.lines.filter(postRentalTaxable).reduce((sum, line) => sum + line.amount_cents, 0);
  const refundTaxCents = refundedTax(input.lines.filter((line) => !postRental(line)), input.rental) + refundedTax(input.lines.filter(postRental), input.other);
  return { salesCents, taxableCents, exemptCents: salesCents - taxableCents, taxCents, refundTaxCents, dueCents: taxCents - refundTaxCents, expectedCents: taxAt(taxableCents, input.rateBps) };
}

export type TaxRow = TaxFigures & { locationId: string; location: string; rateBps: number; orders: number };

const figures = ["salesCents", "taxableCents", "exemptCents", "taxCents", "refundTaxCents", "dueCents"] as const;

export function summarizeTax(orders: Array<TaxFigures & { locationId: string; location: string; rateBps: number }>): { rows: TaxRow[]; total: TaxFigures & { orders: number } } {
  const grouped = new Map<string, TaxRow>();
  const total = { orders: 0, salesCents: 0, taxableCents: 0, exemptCents: 0, taxCents: 0, refundTaxCents: 0, dueCents: 0 };
  for (const order of orders) {
    const key = `${order.locationId}:${order.rateBps}`;
    const row = grouped.get(key) ?? { locationId: order.locationId, location: order.location, rateBps: order.rateBps, orders: 0, salesCents: 0, taxableCents: 0, exemptCents: 0, taxCents: 0, refundTaxCents: 0, dueCents: 0 };
    row.orders += 1;
    total.orders += 1;
    for (const field of figures) {
      row[field] += order[field];
      total[field] += order[field];
    }
    grouped.set(key, row);
  }
  const rows = [...grouped.values()].sort((a, b) => a.location.localeCompare(b.location) || a.rateBps - b.rateBps);
  return { rows, total };
}
