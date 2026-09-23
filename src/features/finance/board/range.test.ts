import { describe, expect, it } from "vitest";
import { boardRange, daysBetween, isDate, isMonth, shiftMonths } from "./range";

describe("boardRange", () => {
  it("runs this month to today against the whole of last month", () => {
    expect(boardRange({}, "2026-11-24")).toEqual({ preset: "month", from: "2026-11-01", to: "2026-11-30", end: "2026-11-24", daysEnd: "2026-11-23", partial: true, prevFrom: "2026-10-01", prevTo: "2026-10-31" });
    expect(boardRange({ preset: "month" }, "2027-03-31")).toMatchObject({ partial: false, daysEnd: "2027-03-30", prevFrom: "2027-02-01", prevTo: "2027-02-28" });
    expect(boardRange({ preset: "month" }, "2026-12-01")).toMatchObject({ from: "2026-12-01", end: "2026-12-01", daysEnd: null });
  });

  it("compares last month with the month before it", () => {
    expect(boardRange({ preset: "last" }, "2026-11-24")).toEqual({ preset: "last", from: "2026-10-01", to: "2026-10-31", end: "2026-10-31", daysEnd: "2026-10-31", partial: false, prevFrom: "2026-09-01", prevTo: "2026-09-30" });
    expect(boardRange({ preset: "last" }, "2027-01-05")).toMatchObject({ from: "2026-12-01", to: "2026-12-31", prevFrom: "2026-11-01", prevTo: "2026-11-30" });
  });

  it("runs this quarter to today against the whole last quarter", () => {
    expect(boardRange({ preset: "quarter" }, "2026-11-24")).toEqual({ preset: "quarter", from: "2026-10-01", to: "2026-12-31", end: "2026-11-24", daysEnd: "2026-11-23", partial: true, prevFrom: "2026-07-01", prevTo: "2026-09-30" });
    expect(boardRange({ preset: "quarter" }, "2027-02-10")).toMatchObject({ from: "2027-01-01", to: "2027-03-31", prevFrom: "2026-10-01", prevTo: "2026-12-31" });
  });

  it("runs this year to today against the whole of last year", () => {
    expect(boardRange({ preset: "year" }, "2026-11-24")).toEqual({ preset: "year", from: "2026-01-01", to: "2026-12-31", end: "2026-11-24", daysEnd: "2026-11-23", partial: true, prevFrom: "2025-01-01", prevTo: "2025-12-31" });
  });

  it("takes whole months for a custom range and compares the same number of months before it", () => {
    expect(boardRange({ preset: "custom", from: "2026-09", to: "2026-10" }, "2026-11-24")).toEqual({ preset: "custom", from: "2026-09-01", to: "2026-10-31", end: "2026-10-31", daysEnd: "2026-10-31", partial: false, prevFrom: "2026-07-01", prevTo: "2026-08-31" });
    expect(boardRange({ preset: "custom", from: "2026-12", to: "2027-02" }, "2027-03-02")).toMatchObject({ from: "2026-12-01", to: "2027-02-28", prevFrom: "2026-09-01", prevTo: "2026-11-30" });
  });

  it("stops a custom range at the current month", () => {
    expect(boardRange({ preset: "custom", from: "2026-10", to: "2027-03" }, "2026-11-24")).toEqual({ preset: "custom", from: "2026-10-01", to: "2026-11-30", end: "2026-11-24", daysEnd: "2026-11-23", partial: true, prevFrom: "2026-08-01", prevTo: "2026-09-30" });
  });

  it("falls back to this month for a bad custom range", () => {
    expect(boardRange({ preset: "custom", from: "2026-11", to: "2026-09" }, "2026-11-24").preset).toBe("month");
    expect(boardRange({ preset: "custom", from: "2026-13", to: "2026-12" }, "2026-11-24").preset).toBe("month");
    expect(boardRange({ preset: "custom", from: "2026-12", to: "2027-01" }, "2026-11-24").preset).toBe("month");
    expect(boardRange({ preset: "custom", from: "2000-01", to: "2026-11" }, "2026-11-24").preset).toBe("month");
    expect(boardRange({ preset: "custom", from: "2026-09-01", to: "2026-09-30" }, "2026-11-24").preset).toBe("month");
    expect(boardRange({ preset: "weekly" }, "2026-11-24").preset).toBe("month");
  });
});

describe("date helpers", () => {
  it("counts days inclusively", () => {
    expect(daysBetween("2026-11-01", "2026-11-30")).toBe(30);
    expect(daysBetween("2026-03-07", "2026-03-09")).toBe(3);
  });

  it("shifts by months and clamps the day", () => {
    expect(shiftMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(shiftMonths("2026-11-12", 60)).toBe("2031-11-12");
    expect(shiftMonths("2026-01-15", -2)).toBe("2025-11-15");
  });

  it("checks dates and months", () => {
    expect(isDate("2026-11-24")).toBe(true);
    expect(isDate("2026-11-31")).toBe(false);
    expect(isDate("11/24/2026")).toBe(false);
    expect(isDate(null)).toBe(false);
    expect(isMonth("2026-11")).toBe(true);
    expect(isMonth("2026-00")).toBe(false);
    expect(isMonth("2026-11-01")).toBe(false);
  });
});
