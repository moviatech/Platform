import { describe, expect, it } from "vitest";
import { daySlots, earliestPickup, withCurrent, zonedParts } from "./time";

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

describe("staff time options", () => {
  it("covers the whole day in steps", () => {
    const slots = daySlots(30);
    expect(slots.length).toBe(48);
    expect(slots[0]).toBe("00:00");
    expect(slots[47]).toBe("23:30");
    expect(slots).toContain("06:30");
    expect(daySlots(60).length).toBe(24);
  });

  it("keeps an order time that is not on the list", () => {
    expect(withCurrent(["08:00", "08:30"], "06:15", "08:30")).toEqual(["06:15", "08:00", "08:30"]);
    expect(withCurrent(["08:00"], "", "bad")).toEqual(["08:00"]);
  });
});
