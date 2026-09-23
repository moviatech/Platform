import { describe, expect, it } from "vitest";
import { coverage, dueDates, isDue, nextDue, occurrence, owedBalances, pendingDates, recurringStartError, resolvedKey } from "./recurring";

const monthly = { id: "r1", starts_on: "2026-09-05", ends_on: null, every_months: 1 };

describe("recurring schedule", () => {
  it("keeps the anchor day and clamps short months", () => {
    const row = { starts_on: "2026-01-31", every_months: 1 };
    expect([1, 2, 13].map((index) => occurrence(row, index))).toEqual(["2026-02-28", "2026-03-31", "2027-02-28"]);
    expect([1, 2].map((index) => occurrence({ starts_on: "2026-11-30", every_months: 3 }, index))).toEqual(["2027-02-28", "2027-05-30"]);
  });

  it("lists due dates up to today and the end date", () => {
    expect(dueDates(monthly, "2026-11-25")).toEqual(["2026-09-05", "2026-10-05", "2026-11-05"]);
    expect(dueDates({ ...monthly, ends_on: "2026-10-05" }, "2026-11-25")).toEqual(["2026-09-05", "2026-10-05"]);
    expect(dueDates({ ...monthly, starts_on: "2026-12-01" }, "2026-11-25")).toEqual([]);
  });

  it("finds the next due date", () => {
    expect(nextDue(monthly, "2026-11-25")).toBe("2026-12-05");
    expect(nextDue({ ...monthly, ends_on: "2026-11-30" }, "2026-11-25")).toBeNull();
    expect(nextDue({ ...monthly, starts_on: "2026-12-20" }, "2026-11-25")).toBe("2026-12-20");
  });

  it("accepts only real, past and unfinished occurrences", () => {
    expect(isDue(monthly, "2026-10-05", "2026-11-25")).toBe(true);
    expect(isDue(monthly, "2026-10-06", "2026-11-25")).toBe(false);
    expect(isDue(monthly, "2026-12-05", "2026-11-25")).toBe(false);
    expect(isDue({ ...monthly, ends_on: "2026-09-30" }, "2026-10-05", "2026-11-25")).toBe(false);
  });

  it("covers one cycle from the due date", () => {
    expect(coverage({ starts_on: "2026-12-05", every_months: 12 }, "2026-12-05")).toEqual({ from: "2026-12-05", to: "2027-12-04" });
    expect(coverage({ starts_on: "2026-01-31", every_months: 1 }, "2026-02-28")).toEqual({ from: "2026-02-28", to: "2026-03-30" });
    expect(coverage({ starts_on: "2026-12-01", every_months: 1 }, "2026-12-01")).toEqual({ from: "2026-12-01", to: "2026-12-31" });
    expect(coverage(monthly, "2026-10-06")).toBeNull();
  });

  it("drops confirmed and skipped dates", () => {
    const resolved = new Set([resolvedKey("r1", "2026-09-05"), resolvedKey("r2", "2026-10-05")]);
    expect(pendingDates(monthly, "2026-11-25", resolved)).toEqual(["2026-10-05", "2026-11-05"]);
  });

  it("limits the start date and checks the end date", () => {
    expect(recurringStartError("2025-11-23", undefined, "2026-11-25")).toBe("start");
    expect(recurringStartError("2027-11-27", undefined, "2026-11-25")).toBe("start");
    expect(recurringStartError("2026-12-01", "2026-11-30", "2026-11-25")).toBe("end");
    expect(recurringStartError("2025-11-24", "2025-11-24", "2026-11-25")).toBeNull();
  });
});

describe("owed balances", () => {
  it("nets card and personal spending against repayments", () => {
    const expenses = [
      { paid_from: "COMPANY_CARD", amount_cents: 12000, voided_at: null },
      { paid_from: "COMPANY_CARD", amount_cents: 5000, voided_at: "2026-11-02T00:00:00Z" },
      { paid_from: "PERSONAL", amount_cents: 3000, voided_at: null },
      { paid_from: "COMPANY_ACCOUNT", amount_cents: 9000, voided_at: null },
    ];
    const settlements = [
      { kind: "CARD_PAYMENT", amount_cents: 10000, voided_at: null },
      { kind: "CARD_PAYMENT", amount_cents: 2000, voided_at: "2026-11-03T00:00:00Z" },
      { kind: "REIMBURSEMENT", amount_cents: 4000, voided_at: null },
    ];
    expect(owedBalances(expenses, settlements)).toEqual({ CARD_PAYMENT: 2000, REIMBURSEMENT: -1000 });
  });
});
