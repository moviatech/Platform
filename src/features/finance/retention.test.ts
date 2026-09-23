import { describe, expect, it } from "vitest";
import { collectedTax, rowRetention, summarizeRetention, type RetentionInput } from "./retention";

const row = (patch: Partial<RetentionInput>): RetentionInput => ({ closed: false, totalCents: 108000, taxCents: 8000, paidCents: 108000, refundedCents: 0, ownership: "OWN", payableCents: 0, ...patch });

describe("collectedTax", () => {
  it("is the full tax once the order is paid in full", () => {
    expect(collectedTax(108000, 8000, 108000)).toBe(8000);
  });

  it("scales with the part of the order actually collected", () => {
    expect(collectedTax(108000, 8000, 54000)).toBe(4000);
  });

  it("is zero when nothing was collected and never exceeds the order's tax", () => {
    expect(collectedTax(108000, 8000, 0)).toBe(0);
    expect(collectedTax(108000, 8000, 150000)).toBe(8000);
    expect(collectedTax(0, 8000, 5000)).toBe(0);
  });
});

describe("rowRetention", () => {
  it("keeps everything but tax on a company car", () => {
    expect(rowRetention(row({}))).toEqual({ collectedCents: 108000, taxCents: 8000, payableCents: 0, retainedCents: 100000 });
  });

  it("takes the owner's share out on an owner car", () => {
    expect(rowRetention(row({ ownership: "PARTNER", payableCents: 60000 })).retainedCents).toBe(40000);
  });

  it("uses money net of refunds", () => {
    const line = rowRetention(row({ refundedCents: 27000 }));
    expect(line.collectedCents).toBe(81000);
    expect(line.taxCents).toBe(6000);
    expect(line.retainedCents).toBe(75000);
  });

  it("shows what is still owed to the owner when the order is not paid yet", () => {
    expect(rowRetention(row({ paidCents: 0, ownership: "PARTNER", payableCents: 60000 }))).toEqual({ collectedCents: 0, taxCents: 0, payableCents: 60000, retainedCents: -60000 });
  });

  it("counts a kept cancellation fee without tax", () => {
    expect(rowRetention(row({ closed: true, paidCents: 108000, refundedCents: 98000 }))).toEqual({ collectedCents: 10000, taxCents: 0, payableCents: 0, retainedCents: 10000 });
  });
});

describe("summarizeRetention", () => {
  it("splits by ownership and totals both", () => {
    const summary = summarizeRetention([row({}), row({ ownership: "PARTNER", payableCents: 60000 }), row({ ownership: "PARTNER", payableCents: 30000, paidCents: 54000 })]);
    expect(summary.OWN).toEqual({ count: 1, collectedCents: 108000, taxCents: 8000, payableCents: 0, retainedCents: 100000 });
    expect(summary.PARTNER).toEqual({ count: 2, collectedCents: 162000, taxCents: 12000, payableCents: 90000, retainedCents: 60000 });
    expect(summary.TOTAL).toEqual({ count: 3, collectedCents: 270000, taxCents: 20000, payableCents: 90000, retainedCents: 160000 });
  });

  it("is all zeros without orders", () => {
    expect(summarizeRetention([]).TOTAL).toEqual({ count: 0, collectedCents: 0, taxCents: 0, payableCents: 0, retainedCents: 0 });
  });
});
