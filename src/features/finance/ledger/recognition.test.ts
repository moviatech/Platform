import { describe, expect, it } from "vitest";
import { zonedToUtc } from "../../booking/time";
import { cumulativeAt, recognizeMonths, type SpreadState } from "./recognition";

const la = (date: string, time: string) => zonedToUtc(date, time, "America/Los_Angeles").getTime();
const hours = (from: number, to: number) => (to - from) / 3600000;

const pickup = la("2026-12-19", "20:00");
const due = la("2027-01-16", "06:00");
const lines = { "4010": 325080, "4020": 84000, "4030": 0, "4930": -211180 };
const single: SpreadState[] = [{ at: pickup - 86400000, end: due, amounts: lines }];
const sum = (values: Record<string, number>) => Object.values(values).reduce((total, value) => total + value, 0);

describe("recognizeMonths for MV-CRFBZ6", () => {
  it("has a 658 hour window with 292 hours in December", () => {
    expect(hours(pickup, due)).toBe(658);
    expect(hours(pickup, la("2027-01-01", "00:00"))).toBe(292);
  });

  it("splits the completed trip into December and January", () => {
    const months = recognizeMonths({ start: pickup, states: single, cutoff: Number.POSITIVE_INFINITY });
    expect(months.map((month) => month.month)).toEqual(["2026-12", "2027-01"]);
    expect(months[0]).toEqual({ month: "2026-12", lastDate: "2026-12-31", amounts: { "4010": 144260, "4020": 37277, "4930": -93715 } });
    expect(months[1]).toEqual({ month: "2027-01", lastDate: "2027-01-16", amounts: { "4010": 180820, "4020": 46723, "4930": -117465 } });
    expect(sum(months[0].amounts)).toBe(87822);
    expect(sum(months[1].amounts)).toBe(110078);
    expect(months[0].amounts["4010"] + months[1].amounts["4010"]).toBe(325080);
    expect(months[0].amounts["4020"] + months[1].amounts["4020"]).toBe(84000);
    expect(months[0].amounts["4930"] + months[1].amounts["4930"]).toBe(-211180);
  });

  it("recognizes only up to the end of yesterday while the trip runs", () => {
    const months = recognizeMonths({ start: pickup, states: single, cutoff: la("2026-12-25", "00:00") });
    expect(months).toEqual([{ month: "2026-12", lastDate: "2026-12-24", amounts: { "4010": 61261, "4020": 15830, "4930": -39797 } }]);
  });

  it("recognizes nothing before pickup or when there is no pricing", () => {
    expect(recognizeMonths({ start: pickup, states: single, cutoff: pickup })).toEqual([]);
    expect(recognizeMonths({ start: pickup, states: [], cutoff: Number.POSITIVE_INFINITY })).toEqual([]);
  });

  it("uses the pricing in force at pickup when it changed before pickup", () => {
    const states: SpreadState[] = [
      { at: pickup - 5 * 86400000, end: due, amounts: { "4010": 999999 } },
      { at: pickup - 86400000, end: due, amounts: { "4010": 325080 } },
    ];
    const months = recognizeMonths({ start: pickup, states, cutoff: Number.POSITIVE_INFINITY });
    expect(months.map((month) => month.amounts["4010"])).toEqual([144260, 180820]);
  });
});

describe("recognizeMonths edge cases", () => {
  it("uses real elapsed hours across the end of daylight saving time", () => {
    const start = la("2027-10-31", "12:00");
    const end = la("2027-11-08", "12:00");
    expect(hours(start, end)).toBe(193);
    const months = recognizeMonths({ start, states: [{ at: start, end, amounts: { "4010": 19300 } }], cutoff: Number.POSITIVE_INFINITY });
    expect(months).toEqual([
      { month: "2027-10", lastDate: "2027-10-31", amounts: { "4010": 1200 } },
      { month: "2027-11", lastDate: "2027-11-08", amounts: { "4010": 18100 } },
    ]);
  });

  it("recognizes the rest at the actual return time after an early return", () => {
    const back = la("2027-01-05", "12:00");
    const states: SpreadState[] = [...single, { at: back, end: back, amounts: lines }];
    const months = recognizeMonths({ start: pickup, states, cutoff: Number.POSITIVE_INFINITY });
    expect(months[0].amounts).toEqual({ "4010": 144260, "4020": 37277, "4930": -93715 });
    expect(months[1]).toEqual({ month: "2027-01", lastDate: "2027-01-05", amounts: { "4010": 180820, "4020": 46723, "4930": -117465 } });
  });

  it("keeps earlier months and spreads an extension over the remaining time", () => {
    const changed = la("2027-01-10", "00:00");
    const newDue = la("2027-01-20", "06:00");
    const states: SpreadState[] = [
      { at: pickup - 86400000, end: due, amounts: { "4010": 325080 } },
      { at: changed, end: newDue, amounts: { "4010": 400000 } },
    ];
    const running = recognizeMonths({ start: pickup, states, cutoff: la("2027-01-15", "00:00") });
    expect(running).toEqual([
      { month: "2026-12", lastDate: "2026-12-31", amounts: { "4010": 144260 } },
      { month: "2027-01", lastDate: "2027-01-14", amounts: { "4010": 179409 } },
    ]);
    const done = recognizeMonths({ start: pickup, states, cutoff: Number.POSITIVE_INFINITY });
    expect(done.map((month) => month.amounts["4010"])).toEqual([144260, 255740]);
    expect(done[1].lastDate).toBe("2027-01-20");
  });

  it("puts a change made after the trip ended entirely into the month of the change", () => {
    const late = la("2027-02-03", "15:00");
    const states: SpreadState[] = [...single, { at: late, end: due, amounts: { ...lines, "4930": -211180 - 5000 } }];
    const months = recognizeMonths({ start: pickup, states, cutoff: Number.POSITIVE_INFINITY });
    expect(months.map((month) => month.month)).toEqual(["2026-12", "2027-01", "2027-02"]);
    expect(months[2]).toEqual({ month: "2027-02", lastDate: "2027-02-03", amounts: { "4930": -5000 } });
  });

  it("rounds each account half away from zero and keeps month totals equal to the lines", () => {
    const start = la("2027-01-18", "00:00");
    const end = la("2027-02-15", "00:00");
    const states: SpreadState[] = [{ at: start, end, amounts: { a: 3, b: -3 } }];
    expect(cumulativeAt(start, states, la("2027-02-01", "00:00")).a).toBeCloseTo(1.5, 10);
    expect(recognizeMonths({ start, states, cutoff: Number.POSITIVE_INFINITY })).toEqual([
      { month: "2027-01", lastDate: "2027-01-31", amounts: { a: 2, b: -2 } },
      { month: "2027-02", lastDate: "2027-02-14", amounts: { a: 1, b: -1 } },
    ]);
  });
});
