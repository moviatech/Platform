import { describe, expect, it } from "vitest";
import { backfillQuote, computeShareBase, coveringAllocation, lateDiscountCents, refundCut, shareOf } from "./share-math";

describe("computeShareBase", () => {
  it("takes rent only and spreads discounts proportionally", () => {
    const base = computeShareBase([
      { type: "RENTAL", code: "rental.daily", amount_cents: 60000 },
      { type: "FEE", code: "fee.delivery", amount_cents: 20000 },
      { type: "DISCOUNT", code: "discount.paynow", amount_cents: -8000 },
      { type: "TAX", code: "tax.sales", amount_cents: 5000 },
      { type: "ADDITIONAL", code: "fee.late", amount_cents: 9000 },
    ]);
    expect(base).toEqual({ rentalCents: 60000, discountCents: 6000, baseCents: 54000 });
  });

  it("is zero without rent", () => {
    expect(computeShareBase([{ type: "ADDITIONAL", code: "fee.late", amount_cents: 9000 }]).baseCents).toBe(0);
  });
});

describe("shareOf", () => {
  it("applies the revenue share and the ownership share", () => {
    expect(shareOf(54000, 6000, 10000)).toBe(32400);
    expect(shareOf(54000, 6000, 5000)).toBe(16200);
  });
});

describe("refundCut", () => {
  it("cuts the share by the refunded fraction of the order total", () => {
    expect(refundCut(32400, 10000, 80000)).toBe(4050);
  });

  it("never cuts more than the share", () => {
    expect(refundCut(32400, 90000, 80000)).toBe(32400);
  });

  it("is zero when nothing was refunded or the total is unknown", () => {
    expect(refundCut(32400, 0, 80000)).toBe(0);
    expect(refundCut(32400, 5000, 0)).toBe(0);
    expect(refundCut(0, 5000, 80000)).toBe(0);
  });
});

describe("backfillQuote", () => {
  const completedAt = "2026-10-01T18:00:00Z";
  const rent = { type: "RENTAL", code: "rental.daily", amount_cents: 100000, created_at: "2026-09-25T18:00:00Z" };
  const tax = { type: "TAX", code: "tax.sales", amount_cents: 8000, created_at: "2026-09-25T18:00:00Z" };
  const quote = (lines: Array<typeof rent>, refundedCents: number, totalCents: number) => backfillQuote({ lines, completedAt, refundedCents, totalCents, revenueShareBps: 6000, shareBps: 10000 });

  it("pays the plain share when nothing was refunded", () => {
    expect(quote([rent, tax], 0, 108000).netCents).toBe(60000);
  });

  it("cuts the share for a refund made after the return", () => {
    const result = quote([rent, tax], 21600, 108000);
    expect(result.cutCents).toBe(12000);
    expect(result.netCents).toBe(48000);
  });

  it("does not count a discount added after the return twice when it was refunded", () => {
    const discount = { type: "DISCOUNT", code: "manual.discount", amount_cents: -20000, created_at: "2026-10-03T18:00:00Z" };
    expect(lateDiscountCents([rent, tax, discount], completedAt)).toBe(20000);
    const result = quote([rent, tax, discount], 20000, 88000);
    expect(result.shareCents).toBe(48000);
    expect(result.cutCents).toBe(0);
    expect(result.netCents).toBe(48000);
  });

  it("still cuts for the part of a refund beyond the later discount", () => {
    const discount = { type: "DISCOUNT", code: "manual.discount", amount_cents: -20000, created_at: "2026-10-03T18:00:00Z" };
    const result = quote([rent, tax, discount], 31000, 88000);
    expect(result.refundCents).toBe(11000);
    expect(result.cutCents).toBe(6000);
  });

  it("treats a discount from before the return as part of the price only", () => {
    const discount = { type: "DISCOUNT", code: "discount.paynow", amount_cents: -20000, created_at: "2026-09-25T18:00:00Z" };
    expect(lateDiscountCents([rent, tax, discount], completedAt)).toBe(0);
    expect(quote([rent, tax, discount], 8800, 88000).cutCents).toBe(4800);
  });
});

describe("coveringAllocation", () => {
  const spans = [
    { id: "old", effective_from: "2026-06-01", effective_to: "2026-08-31" },
    { id: "new", effective_from: "2026-09-10", effective_to: null },
  ];

  it("finds the allocation whose period holds the date", () => {
    expect(coveringAllocation(spans, "2026-07-15")?.id).toBe("old");
    expect(coveringAllocation(spans, "2026-09-10")?.id).toBe("new");
    expect(coveringAllocation(spans, "2026-12-01")?.id).toBe("new");
  });

  it("returns nothing in a gap or before the first period", () => {
    expect(coveringAllocation(spans, "2026-09-05")).toBeNull();
    expect(coveringAllocation(spans, "2026-05-31")).toBeNull();
  });

  it("includes the last day of an ended period", () => {
    expect(coveringAllocation(spans, "2026-08-31")?.id).toBe("old");
  });

  it("prefers the later start when periods overlap", () => {
    const overlapping = [...spans, { id: "late", effective_from: "2026-08-20", effective_to: null }];
    expect(coveringAllocation(overlapping, "2026-08-25")?.id).toBe("late");
  });
});
