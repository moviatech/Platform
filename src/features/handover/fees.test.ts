import { describe, expect, it } from "vitest";
import { computeReturnFees, feeTotal } from "./fees";

const base = {
  startOdometer: 1000,
  endOdometer: 1500,
  allowanceMiles: 600,
  excessRateCents: 99,
  batteryLevel: 85,
  minReturnLevel: 80,
  lowChargeFeeCentsPerPercent: 50,
  chargingIncluded: false,
  scheduledReturnAt: "2026-09-30T17:00:00.000Z",
  actualReturnAt: "2026-09-30T17:20:00.000Z",
  graceMinutes: 29,
  dailyRateCents: 12900,
  lateHourlyCapHours: 5,
  superchargingCents: 0,
  cleaningCents: 0,
  otherCents: 0,
};

describe("computeReturnFees", () => {
  it("charges nothing inside allowance, charge level and grace", () => {
    expect(computeReturnFees(base)).toEqual([]);
  });

  it("charges excess miles at the class rate", () => {
    const lines = computeReturnFees({ ...base, endOdometer: 1650 });
    expect(lines).toEqual([{ code: "excess_mileage", quantity: 50, unitCents: 99, amountCents: 4950 }]);
  });

  it("ignores mileage with the unlimited option", () => {
    expect(computeReturnFees({ ...base, endOdometer: 9000, allowanceMiles: null })).toEqual([]);
  });

  it("charges each percentage point below the return target unless charging is included", () => {
    expect(computeReturnFees({ ...base, batteryLevel: 62 })).toEqual([{ code: "low_charge", quantity: 18, unitCents: 50, amountCents: 900 }]);
    expect(computeReturnFees({ ...base, batteryLevel: 62, chargingIncluded: true })).toEqual([]);
  });

  it("charges late hours up to the cap, then whole days", () => {
    expect(computeReturnFees({ ...base, actualReturnAt: "2026-09-30T17:30:00.000Z" })).toEqual([{ code: "late_hours", quantity: 1, unitCents: 538, amountCents: 538 }]);
    expect(computeReturnFees({ ...base, actualReturnAt: "2026-09-30T22:20:00.000Z" })).toEqual([{ code: "late_hours", quantity: 5, unitCents: 538, amountCents: 2690 }]);
    expect(computeReturnFees({ ...base, actualReturnAt: "2026-09-30T23:00:00.000Z" })).toEqual([{ code: "late_return", quantity: 1, unitCents: 12900, amountCents: 12900 }]);
    expect(computeReturnFees({ ...base, actualReturnAt: "2026-10-02T09:00:00.000Z" })[0]).toMatchObject({ code: "late_return", quantity: 2 });
  });

  it("sums manual cleaning and other charges", () => {
    const lines = computeReturnFees({ ...base, cleaningCents: 40000, otherCents: 1500 });
    expect(feeTotal(lines)).toBe(41500);
  });
});
