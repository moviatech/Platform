import { describe, expect, it } from "vitest";
import { earliestPickup, zonedParts } from "./time";

const zone = "America/Los_Angeles";
const window = { start: "08:00", end: "20:00", stepMinutes: 30 };
const local = (instant: Date) => {
  const parts = zonedParts(instant, zone);
  return `${parts.date} ${parts.time}`;
};

describe("earliestPickup", () => {
  it("rounds up to the next slot inside the window", () => {
    expect(local(earliestPickup(window, 2, zone, Date.parse("2026-11-10T18:10:00Z")))).toBe("2026-11-10 12:30");
  });

  it("keeps an exact slot", () => {
    expect(local(earliestPickup(window, 2, zone, Date.parse("2026-11-10T18:00:00Z")))).toBe("2026-11-10 12:00");
  });

  it("moves to the window start before opening", () => {
    expect(local(earliestPickup(window, 2, zone, Date.parse("2026-11-10T11:00:00Z")))).toBe("2026-11-10 08:00");
  });

  it("moves to the next day after closing", () => {
    expect(local(earliestPickup(window, 2, zone, Date.parse("2026-11-11T03:30:00Z")))).toBe("2026-11-11 08:00");
  });

  it("accepts the last slot of the day", () => {
    expect(local(earliestPickup(window, 2, zone, Date.parse("2026-11-11T02:00:00Z")))).toBe("2026-11-10 20:00");
  });
});
