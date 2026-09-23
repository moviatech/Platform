import { describe, expect, it } from "vitest";
import { cancellationFeeCents, listDailyCents, type CancelPolicy } from "./cancellation";

const policy: CancelPolicy = {
  short: { freeHours: 24, lateDays: 1, noShowMaxDays: 3 },
  monthly: { freeHours: 72, feeHours: 48, feeCents: 10000, lateHours: 24, lateDays: 1, finalDays: 2, noShowDays: 3 },
};

const pickupAt = new Date("2026-10-10T17:00:00Z");
const hoursBefore = (hours: number) => new Date(pickupAt.getTime() - hours * 3600000);
const short = { policy, rentalDays: 4, listDailyCents: 12900, totalCents: 60000, pickupAt, noShow: false };
const monthly = { policy, rentalDays: 30, listDailyCents: 12900, totalCents: 250000, pickupAt, noShow: false };

describe("listDailyCents", () => {
  it("undoes the tier multiplier", () => {
    expect(listDailyCents(7095, 5500)).toBe(12900);
    expect(listDailyCents(12900, 10000)).toBe(12900);
  });
});

describe("short rentals", () => {
  it("is free 24h or more before pickup", () => {
    expect(cancellationFeeCents({ ...short, at: hoursBefore(24) })).toBe(0);
    expect(cancellationFeeCents({ ...short, at: hoursBefore(200) })).toBe(0);
  });
  it("charges one list-price day inside 24h", () => {
    expect(cancellationFeeCents({ ...short, at: hoursBefore(23.9) })).toBe(12900);
    expect(cancellationFeeCents({ ...short, at: hoursBefore(0.5) })).toBe(12900);
  });
  it("charges up to three days for a no-show, capped by rental length", () => {
    expect(cancellationFeeCents({ ...short, at: hoursBefore(-2), noShow: true })).toBe(38700);
    expect(cancellationFeeCents({ ...short, rentalDays: 2, at: hoursBefore(-2), noShow: true })).toBe(25800);
  });
});

describe("monthly rentals", () => {
  it("steps down through the windows", () => {
    expect(cancellationFeeCents({ ...monthly, at: hoursBefore(72) })).toBe(0);
    expect(cancellationFeeCents({ ...monthly, at: hoursBefore(60) })).toBe(10000);
    expect(cancellationFeeCents({ ...monthly, at: hoursBefore(30) })).toBe(12900);
    expect(cancellationFeeCents({ ...monthly, at: hoursBefore(5) })).toBe(25800);
    expect(cancellationFeeCents({ ...monthly, at: hoursBefore(-1), noShow: true })).toBe(38700);
  });
});

it("never exceeds the reservation total", () => {
  expect(cancellationFeeCents({ ...short, totalCents: 10000, at: hoursBefore(1) })).toBe(10000);
});
