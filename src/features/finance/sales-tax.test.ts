import { describe, expect, it } from "vitest";
import { firstPeriodDate, orderTax, parsePeriod, periodOf, summarizeTax, switchPeriod, type Collected, type TaxLine } from "./sales-tax";

const line = (type: string, code: string, amount_cents: number, taxable = true): TaxLine => ({ type, code, amount_cents, taxable });
const got = (paidCents = 0, refundedCents = 0): Collected => ({ paidCents, refundedCents });

describe("parsePeriod", () => {
  it("reads a month, a quarter and a year", () => {
    expect(parsePeriod("2026-02", "2026-11-18")).toEqual({ key: "2026-02", kind: "month", from: "2026-02-01", to: "2026-02-28", previous: "2026-01", next: "2026-03" });
    expect(parsePeriod("2026-Q4", "2026-11-18")).toEqual({ key: "2026-Q4", kind: "quarter", from: "2026-10-01", to: "2026-12-31", previous: "2026-Q3", next: "2027-Q1" });
    expect(parsePeriod("2028", "2026-11-18")).toEqual({ key: "2028", kind: "year", from: "2028-01-01", to: "2028-12-31", previous: "2027", next: "2029" });
  });

  it("crosses year boundaries", () => {
    expect(parsePeriod("2026-01", "2026-11-18").previous).toBe("2025-12");
    expect(parsePeriod("2026-12", "2026-11-18").next).toBe("2027-01");
    expect(parsePeriod("2026-Q1", "2026-11-18").previous).toBe("2025-Q4");
    expect(parsePeriod("2028-02", "2026-11-18").to).toBe("2028-02-29");
  });

  it("falls back to the current quarter", () => {
    expect(parsePeriod(undefined, "2026-11-18").key).toBe("2026-Q4");
    expect(parsePeriod("2026-13", "2026-02-03").key).toBe("2026-Q1");
    expect(parsePeriod("1999", "2026-07-01").key).toBe("2026-Q3");
    expect(parsePeriod(["2026-01"], "2026-07-01").key).toBe("2026-Q3");
  });

  it("marks the earliest period of every kind", () => {
    for (const key of ["2020", "2020-Q1", "2020-01"]) expect(parsePeriod(key, "2026-11-18").from).toBe(firstPeriodDate);
    for (const key of ["2020-Q2", "2020-02", "2021"]) expect(parsePeriod(key, "2026-11-18").from > firstPeriodDate).toBe(true);
  });

  it("switches granularity around today when today is inside the period", () => {
    expect(switchPeriod(parsePeriod("2026-Q4", "2026-11-18"), "month", "2026-11-18").key).toBe("2026-11");
    expect(switchPeriod(parsePeriod("2026-Q1", "2026-11-18"), "month", "2026-11-18").key).toBe("2026-01");
    expect(switchPeriod(parsePeriod("2026-05", "2026-11-18"), "quarter", "2026-11-18").key).toBe("2026-Q2");
    expect(switchPeriod(parsePeriod("2026-05", "2026-11-18"), "year", "2026-11-18").key).toBe("2026");
    expect(periodOf("quarter", "2026-09-30").key).toBe("2026-Q3");
  });
});

describe("orderTax", () => {
  it("splits taxable and untaxed sales and checks the tax against the rate", () => {
    const lines = [line("RENTAL", "rental.daily", 40000), line("PROTECTION", "protection.basic", 6000, false), line("TAX", "tax.sales", 3750, false)];
    expect(orderTax({ rateBps: 937.5, taxableCents: 40000, lines, rental: got(49750), other: got() })).toEqual({ salesCents: 46000, taxableCents: 40000, exemptCents: 6000, taxCents: 3750, refundTaxCents: 0, dueCents: 3750, expectedCents: 3750 });
  });

  it("adds taxed post-rental charges and their tax", () => {
    const lines = [line("RENTAL", "rental.daily", 20000), line("TAX", "tax.sales", 1550, false), line("ADDITIONAL", "fee.late", 5000), line("ADDITIONAL", "fee.tax", 388, false), line("ADDITIONAL", "charge.toll", 1200, false)];
    const result = orderTax({ rateBps: 775, taxableCents: 20000, lines, rental: got(21550), other: got(6588) });
    expect(result.salesCents).toBe(26200);
    expect(result.taxableCents).toBe(25000);
    expect(result.exemptCents).toBe(1200);
    expect(result.taxCents).toBe(1938);
    expect(result.expectedCents).toBe(1938);
    expect(result.refundTaxCents).toBe(0);
  });

  it("leaves manual adjustments outside the taxable amount", () => {
    const lines = [line("RENTAL", "rental.daily", 26700), line("DISCOUNT", "discount.pay_now", -534), line("DISCOUNT", "manual.discount", -5000, false), line("TAX", "tax.sales", 2028, false)];
    const result = orderTax({ rateBps: 775, taxableCents: 26166, lines, rental: got(23194), other: got() });
    expect(result.salesCents).toBe(21166);
    expect(result.taxableCents).toBe(26166);
    expect(result.exemptCents).toBe(-5000);
    expect(result.dueCents).toBe(2028);
  });

  it("takes back the tax share of a refund that lowered what the customer paid", () => {
    const lines = [line("RENTAL", "rental.daily", 100000), line("TAX", "tax.sales", 8000, false)];
    const result = orderTax({ rateBps: 800, taxableCents: 100000, lines, rental: got(108000, 10800), other: got() });
    expect(result.refundTaxCents).toBe(800);
    expect(result.dueCents).toBe(7200);
  });

  it("ignores a refund of an overpayment and an unpaid balance", () => {
    const lines = [line("RENTAL", "rental.daily", 80000), line("TAX", "tax.sales", 6400, false)];
    expect(orderTax({ rateBps: 800, taxableCents: 80000, lines, rental: got(108000, 21600), other: got() }).refundTaxCents).toBe(0);
    expect(orderTax({ rateBps: 800, taxableCents: 80000, lines, rental: got(), other: got() }).refundTaxCents).toBe(0);
    expect(orderTax({ rateBps: 800, taxableCents: 80000, lines, rental: got(20000), other: got() }).dueCents).toBe(6400);
  });

  it("does not take back tax when an untaxed post-rental charge is refunded", () => {
    const lines = [line("RENTAL", "rental.daily", 100000), line("TAX", "tax.sales", 7750, false), line("ADDITIONAL", "fee.late", 5000, false)];
    expect(orderTax({ rateBps: 775, taxableCents: 100000, lines, rental: got(107750), other: got(5000, 5000) })).toMatchObject({ taxCents: 7750, refundTaxCents: 0, dueCents: 7750 });
  });

  it("keeps an overpayment refund apart from post-rental charges that were never collected", () => {
    const lines = [line("RENTAL", "rental.daily", 80000), line("TAX", "tax.sales", 6400, false), line("ADDITIONAL", "fee.late", 5000), line("ADDITIONAL", "fee.tax", 400, false)];
    expect(orderTax({ rateBps: 800, taxableCents: 80000, lines, rental: got(108000, 21600), other: got() })).toMatchObject({ taxCents: 6800, refundTaxCents: 0, dueCents: 6800 });
  });

  it("still sees a rental refund when another charge without a line was collected", () => {
    const lines = [line("RENTAL", "rental.daily", 100000), line("TAX", "tax.sales", 8000, false)];
    expect(orderTax({ rateBps: 800, taxableCents: 100000, lines, rental: got(108000, 21600), other: got(50000) })).toMatchObject({ refundTaxCents: 1600, dueCents: 6400 });
  });

  it("takes back the tax on a refunded taxed post-rental charge", () => {
    const lines = [line("RENTAL", "rental.daily", 20000), line("TAX", "tax.sales", 1600, false), line("ADDITIONAL", "fee.late", 5000), line("ADDITIONAL", "fee.tax", 400, false)];
    expect(orderTax({ rateBps: 800, taxableCents: 20000, lines, rental: got(21600), other: got(5400, 5400) })).toMatchObject({ taxCents: 2000, refundTaxCents: 400, dueCents: 1600 });
  });

  it("never takes back more tax than was billed", () => {
    const lines = [line("RENTAL", "rental.daily", 10000), line("TAX", "tax.sales", 800, false)];
    expect(orderTax({ rateBps: 800, taxableCents: 10000, lines, rental: got(10800, 10800), other: got() })).toMatchObject({ refundTaxCents: 800, dueCents: 0 });
    expect(orderTax({ rateBps: 0, taxableCents: 10000, lines: [line("RENTAL", "rental.daily", 10000)], rental: got(10000, 10000), other: got() })).toMatchObject({ taxCents: 0, refundTaxCents: 0, dueCents: 0 });
  });
});

describe("summarizeTax", () => {
  it("groups by location and rate and totals every column", () => {
    const order = (locationId: string, location: string, rateBps: number, salesCents: number, taxCents: number) => ({ locationId, location, rateBps, salesCents, taxableCents: salesCents, exemptCents: 0, taxCents, refundTaxCents: 0, dueCents: taxCents });
    const { rows, total } = summarizeTax([order("b", "San Jose", 937.5, 10000, 938), order("a", "Irvine", 775, 20000, 1550), order("a", "Irvine", 775, 10000, 775), order("a", "Irvine", 0, 5000, 0)]);
    expect(rows.map((row) => [row.location, row.rateBps, row.orders, row.salesCents, row.taxCents])).toEqual([
      ["Irvine", 0, 1, 5000, 0],
      ["Irvine", 775, 2, 30000, 2325],
      ["San Jose", 937.5, 1, 10000, 938],
    ]);
    expect(total).toEqual({ orders: 4, salesCents: 45000, taxableCents: 45000, exemptCents: 0, taxCents: 3263, refundTaxCents: 0, dueCents: 3263 });
  });

  it("returns zeros for no orders", () => {
    expect(summarizeTax([])).toEqual({ rows: [], total: { orders: 0, salesCents: 0, taxableCents: 0, exemptCents: 0, taxCents: 0, refundTaxCents: 0, dueCents: 0 } });
  });
});
