import { describe, expect, it } from "vitest";
import { addDays, dayStart, laDate, lastDayOf, monthStart, nextMonth, roundHalfAway, todayStart } from "./dates";

describe("ledger dates", () => {
  it("reads the Los Angeles calendar date of an instant", () => {
    expect(laDate("2026-11-17T19:23:00Z")).toBe("2026-11-17");
    expect(laDate("2026-12-01T07:59:59Z")).toBe("2026-11-30");
    expect(laDate("2026-12-01T08:00:00Z")).toBe("2026-12-01");
    expect(laDate("2027-07-01T06:59:00Z")).toBe("2027-06-30");
  });

  it("finds month and day starts in Los Angeles time across daylight saving", () => {
    expect(new Date(monthStart("2026-12")).toISOString()).toBe("2026-12-01T08:00:00.000Z");
    expect(new Date(monthStart("2027-04")).toISOString()).toBe("2027-04-01T07:00:00.000Z");
    expect(new Date(dayStart("2027-03-14")).toISOString()).toBe("2027-03-14T08:00:00.000Z");
    expect(new Date(dayStart("2027-03-15")).toISOString()).toBe("2027-03-15T07:00:00.000Z");
    expect(new Date(todayStart(Date.parse("2026-11-25T03:00:00Z"))).toISOString()).toBe("2026-11-24T08:00:00.000Z");
  });

  it("does calendar arithmetic", () => {
    expect(nextMonth("2026-12")).toBe("2027-01");
    expect(nextMonth("2027-01")).toBe("2027-02");
    expect(lastDayOf("2027-02")).toBe("2027-02-28");
    expect(lastDayOf("2028-02")).toBe("2028-02-29");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2027-03-01", -1)).toBe("2027-02-28");
  });

  it("rounds halves away from zero", () => {
    expect(roundHalfAway(2.5)).toBe(3);
    expect(roundHalfAway(-2.5)).toBe(-3);
    expect(roundHalfAway(-93714.9)).toBe(-93715);
    expect(roundHalfAway(144260.3)).toBe(144260);
  });
});
