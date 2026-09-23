import { describe, expect, it } from "vitest";
import { renewalDue } from "./renewal-plan";

const now = Date.parse("2026-12-25T12:00:00Z");
const at = (hours: number) => new Date(now + hours * 3600000).toISOString();
const base = { status: "ACTIVE", expiresAt: at(20), returnAt: at(22 * 24), lastFailureAt: null, now };

describe("renewalDue", () => {
  it("renews a hold that runs out while the car is still out", () => {
    expect(renewalDue(base)).toBe(true);
    expect(renewalDue({ ...base, status: "CONFIRMED" })).toBe(true);
  });

  it("leaves finished, cancelled or undated holds alone", () => {
    expect(renewalDue({ ...base, status: "COMPLETED" })).toBe(false);
    expect(renewalDue({ ...base, status: "CANCELLED" })).toBe(false);
    expect(renewalDue({ ...base, expiresAt: null })).toBe(false);
  });

  it("keeps a deposit in place for two days past the return", () => {
    expect(renewalDue({ ...base, returnAt: at(10), expiresAt: at(30) })).toBe(true);
    expect(renewalDue({ ...base, returnAt: at(10), expiresAt: at(57) })).toBe(true);
    expect(renewalDue({ ...base, returnAt: at(10), expiresAt: at(58) })).toBe(false);
  });

  it("still renews when the car is overdue", () => {
    expect(renewalDue({ ...base, returnAt: at(-72), expiresAt: at(20) })).toBe(true);
    expect(renewalDue({ ...base, returnAt: at(-72), expiresAt: at(49) })).toBe(false);
  });

  it("stops renewing a hold on an order that was never picked up once its dates have passed", () => {
    expect(renewalDue({ ...base, status: "CONFIRMED", returnAt: at(-72), expiresAt: at(20) })).toBe(false);
    expect(renewalDue({ ...base, status: "CONFIRMED", returnAt: at(-20), expiresAt: at(20) })).toBe(true);
  });

  it("waits twelve hours after a refused attempt before trying the card again", () => {
    expect(renewalDue({ ...base, lastFailureAt: at(-1) })).toBe(false);
    expect(renewalDue({ ...base, lastFailureAt: at(-11.9) })).toBe(false);
    expect(renewalDue({ ...base, lastFailureAt: at(-12) })).toBe(true);
    expect(renewalDue({ ...base, lastFailureAt: at(-30) })).toBe(true);
  });

  it("makes one last attempt in the final two hours", () => {
    expect(renewalDue({ ...base, expiresAt: at(1.5), lastFailureAt: at(-9) })).toBe(true);
    expect(renewalDue({ ...base, expiresAt: at(1.5), lastFailureAt: at(-0.2) })).toBe(false);
    expect(renewalDue({ ...base, expiresAt: at(3), lastFailureAt: at(-9) })).toBe(false);
  });
});
