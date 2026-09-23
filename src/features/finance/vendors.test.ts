import { describe, expect, it } from "vitest";
import { linkableExpenses, matchVendor, missingW9, nonCardTotals, unlinkedPayees } from "./vendors";

const vendors = [
  { id: "v1", name: "Sparkle  Cleaning", active: true },
  { id: "v2", name: "Old Garage", active: false },
];

describe("vendor directory", () => {
  it("matches a typed payee by name, ignoring case and spaces, active vendors only", () => {
    expect(matchVendor("  sparkle cleaning ", vendors)?.id).toBe("v1");
    expect(matchVendor("Old Garage", vendors)).toBeNull();
    expect(matchVendor("Sparkle", vendors)).toBeNull();
    expect(matchVendor("", vendors)).toBeNull();
    expect(matchVendor(null, vendors)).toBeNull();
  });

  it("adds up this year's payments that were not made by card", () => {
    const totals = nonCardTotals([
      { vendor_id: "v1", method: "ZELLE", amount_cents: 150000, voided_at: null },
      { vendor_id: "v1", method: "CHECK", amount_cents: 60000, voided_at: null },
      { vendor_id: "v1", method: "CARD", amount_cents: 99999, voided_at: null },
      { vendor_id: "v1", method: "ACH", amount_cents: 50000, voided_at: "2026-11-02T00:00:00Z" },
      { vendor_id: null, method: "CASH", amount_cents: 1000, voided_at: null },
    ]);
    expect(Object.fromEntries(totals)).toEqual({ v1: 210000 });
  });

  it("flags a 1099 vendor over the threshold without a W-9", () => {
    expect(missingW9({ needs_1099: true, w9_received_on: null }, 200000)).toBe(true);
    expect(missingW9({ needs_1099: true, w9_received_on: null }, 199999)).toBe(false);
    expect(missingW9({ needs_1099: true, w9_received_on: "2026-11-01" }, 500000)).toBe(false);
    expect(missingW9({ needs_1099: false, w9_received_on: null }, 500000)).toBe(false);
  });
});

describe("payees without a vendor", () => {
  it("groups this year's unlinked payments that were not by card", () => {
    const rows = [
      { vendor: "Sparkle Cleaning Inc.", vendor_id: null, method: "ZELLE", amount_cents: 80000, voided_at: null },
      { vendor: "sparkle  cleaning inc.", vendor_id: null, method: "CHECK", amount_cents: 40000, voided_at: null },
      { vendor: "Tire Shop", vendor_id: null, method: "CASH", amount_cents: 30000, voided_at: null },
      { vendor: "Tire Shop", vendor_id: null, method: "CARD", amount_cents: 99999, voided_at: null },
      { vendor: "Linked Co", vendor_id: "v9", method: "ACH", amount_cents: 50000, voided_at: null },
      { vendor: "Voided Co", vendor_id: null, method: "ACH", amount_cents: 50000, voided_at: "2026-11-02T00:00:00Z" },
      { vendor: "  ", vendor_id: null, method: "ACH", amount_cents: 5000, voided_at: null },
    ];
    expect(unlinkedPayees(rows)).toEqual([
      { name: "Sparkle Cleaning Inc.", cents: 120000 },
      { name: "Tire Shop", cents: 30000 },
    ]);
  });

  it("finds earlier expenses a new vendor name should link to", () => {
    const rows = [
      { id: "e1", vendor: "Sparkle  cleaning", vendor_id: null },
      { id: "e2", vendor: "Sparkle Cleaning", vendor_id: "v1" },
      { id: "e3", vendor: "Sparkle Cleaning Inc.", vendor_id: null },
      { id: "e4", vendor: null, vendor_id: null },
    ];
    expect(linkableExpenses(" sparkle cleaning ", rows)).toEqual(["e1"]);
  });
});
