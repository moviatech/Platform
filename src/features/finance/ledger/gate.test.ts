import { describe, expect, it } from "vitest";
import { checkGate, type GateInput } from "./gate";
import { investorIncluded, orderInclusion, pendingInclusionIssue } from "./inclusion";

const now = Date.parse("2026-12-20T12:00:00Z");
const old = "2026-12-01T00:00:00Z";
const base: GateInput = {
  status: "CONFIRMED",
  totalCents: 197900,
  updatedAtBefore: old,
  updatedAtAfter: old,
  now,
  lines: [
    { type: "RENTAL", code: "rental.monthly", amount_cents: 325080, created_at: old },
    { type: "PROTECTION", code: "protection.full", amount_cents: 84000, created_at: old },
    { type: "ADD_ON", code: "addon.driver", amount_cents: 0, created_at: old },
    { type: "DISCOUNT", code: "manual.discount", amount_cents: -211180, created_at: old },
  ],
};

describe("checkGate", () => {
  it("passes a consistent order", () => {
    expect(checkGate(base)).toEqual({ ok: true });
  });

  it("ignores non-manual additional charges in the total but counts manual ones", () => {
    const lines = [...base.lines, { type: "ADDITIONAL", code: "charge.toll", amount_cents: 1500, created_at: old }, { type: "ADDITIONAL", code: "manual.fee", amount_cents: 2000, created_at: old }];
    expect(checkGate({ ...base, lines, totalCents: 199900 })).toEqual({ ok: true });
    expect(checkGate({ ...base, lines })).toEqual({ ok: false, reason: "total_mismatch" });
  });

  it("needs exactly one paid rental line while the order is live", () => {
    expect(checkGate({ ...base, lines: base.lines.filter((line) => line.type !== "RENTAL"), totalCents: 197900 - 325080 })).toEqual({ ok: false, reason: "rental_line" });
    const twice = [...base.lines, { type: "RENTAL", code: "rental.daily", amount_cents: 100, created_at: old }];
    expect(checkGate({ ...base, lines: twice, totalCents: 198000 })).toEqual({ ok: false, reason: "rental_line" });
    expect(checkGate({ ...base, status: "CANCELLED", lines: [], totalCents: 0 })).toEqual({ ok: true });
  });

  it("refuses duplicate quoted codes but allows repeated additional and manual lines", () => {
    const duplicate = [...base.lines, { type: "PROTECTION", code: "protection.full", amount_cents: 0, created_at: old }];
    expect(checkGate({ ...base, lines: duplicate })).toEqual({ ok: false, reason: "duplicate_code" });
    const repeated = [...base.lines, { type: "DISCOUNT", code: "manual.discount", amount_cents: -100, created_at: old }, { type: "ADDITIONAL", code: "charge.toll", amount_cents: 300, created_at: old }, { type: "ADDITIONAL", code: "charge.toll", amount_cents: 300, created_at: old }];
    expect(checkGate({ ...base, lines: repeated, totalCents: 197800 })).toEqual({ ok: true });
  });

  it("waits while the order is being edited", () => {
    expect(checkGate({ ...base, updatedAtAfter: "2026-12-02T00:00:00Z" })).toEqual({ ok: false, reason: "changed_while_reading" });
    const fresh = new Date(now - 60000).toISOString();
    expect(checkGate({ ...base, updatedAtBefore: fresh, updatedAtAfter: fresh })).toEqual({ ok: false, reason: "recently_changed" });
    const freshLine = [...base.lines.slice(0, 3), { ...base.lines[3], created_at: fresh }];
    expect(checkGate({ ...base, lines: freshLine })).toEqual({ ok: false, reason: "recently_changed" });
  });

  it("treats a negative line total as a data error", () => {
    const lines = [{ type: "RENTAL", code: "rental.daily", amount_cents: 100, created_at: old }, { type: "DISCOUNT", code: "manual.discount", amount_cents: -500, created_at: old }];
    expect(checkGate({ ...base, lines, totalCents: -400 })).toEqual({ ok: false, reason: "negative_total" });
  });
});

describe("inclusion", () => {
  it("follows the override first, then test orders, then live Stripe money", () => {
    expect(orderInclusion({ test: true, liveStripe: true, override: null })).toBe("excluded");
    expect(orderInclusion({ test: false, liveStripe: true, override: null })).toBe("included");
    expect(orderInclusion({ test: false, liveStripe: false, override: null })).toBe("pending");
    expect(orderInclusion({ test: true, liveStripe: false, override: true })).toBe("included");
    expect(orderInclusion({ test: false, liveStripe: true, override: false })).toBe("excluded");
  });

  it("leaves out the house account unless overridden", () => {
    expect(investorIncluded({ house: true, override: null })).toBe(false);
    expect(investorIncluded({ house: false, override: null })).toBe(true);
    expect(investorIncluded({ house: false, override: false })).toBe(false);
  });

  it("opens a pending question only after a started order has waited for Stripe", () => {
    const order = { id: "r1", number: "MV-ABCDEF", status: "ACTIVE", actualPickupAt: "2026-12-20T08:00:00Z" };
    expect(pendingInclusionIssue(order, "pending", now)).toMatchObject({ kind: "inclusion_pending", dedupeKey: "inclusion_pending:r1", reservationId: "r1" });
    expect(pendingInclusionIssue(order, "pending", Date.parse("2026-12-20T09:00:00Z"))).toBeNull();
    expect(pendingInclusionIssue(order, "included", now)).toBeNull();
    expect(pendingInclusionIssue({ ...order, status: "CONFIRMED", actualPickupAt: null }, "pending", now)).toBeNull();
  });
});
