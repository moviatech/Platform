import { describe, expect, it } from "vitest";
import { isYear, ownerYearTotals, yearBounds } from "./owners";

describe("ownerYearTotals", () => {
  const entries = [
    { investor_id: "a", type: "RENTAL_SHARE", bucket: "AVAILABLE", amount_cents: 60000, reversal_of: null },
    { investor_id: "a", type: "RENTAL_SHARE", bucket: "PENDING", amount_cents: 36000, reversal_of: null },
    { investor_id: "a", type: "ADJUSTMENT", bucket: "AVAILABLE", amount_cents: -4500, reversal_of: null },
    { investor_id: "a", type: "REVERSAL", bucket: "AVAILABLE", amount_cents: -36000, reversal_of: "share-2" },
    { investor_id: "a", type: "REVERSAL", bucket: "AVAILABLE", amount_cents: -100000, reversal_of: "capital-1" },
    { investor_id: "a", type: "CAPITAL_IN", bucket: "AVAILABLE", amount_cents: 4500000, reversal_of: null },
    { investor_id: "a", type: "CAPITAL_RETURN", bucket: "AVAILABLE", amount_cents: 4000000, reversal_of: null },
    { investor_id: "a", type: "CAPITAL_RETURN", bucket: "INVESTED", amount_cents: -4200000, reversal_of: null },
    { investor_id: "a", type: "WITHHELD", bucket: "AVAILABLE", amount_cents: -50000, reversal_of: null },
    { investor_id: "b", type: "MILEAGE_FEE", bucket: "PENDING", amount_cents: 40000, reversal_of: null },
  ];
  const originals = new Map([["share-2", "RENTAL_SHARE"], ["capital-1", "CAPITAL_IN"]]);

  it("counts shares, mileage fees and their corrections as earnings", () => {
    const totals = ownerYearTotals(entries, originals, [{ investor_id: "a", amount_cents: 50000 }]);
    expect(totals.get("a")).toEqual({ earningsCents: 55500, capitalReturnedCents: 4000000, paidCents: 50000 });
    expect(totals.get("b")).toEqual({ earningsCents: 40000, capitalReturnedCents: 0, paidCents: 0 });
  });

  it("lists an owner who was only paid this year", () => {
    expect(ownerYearTotals([], new Map(), [{ investor_id: "c", amount_cents: 12000 }]).get("c")).toEqual({ earningsCents: 0, capitalReturnedCents: 0, paidCents: 12000 });
  });
});

describe("years", () => {
  it("validates and bounds a calendar year", () => {
    expect(isYear("2026")).toBe(true);
    expect(isYear("26")).toBe(false);
    expect(yearBounds(2026)).toEqual({ from: "2026-01-01", to: "2026-12-31" });
  });
});
