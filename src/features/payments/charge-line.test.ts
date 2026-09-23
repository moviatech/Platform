import { describe, expect, it } from "vitest";
import { approvedCharge, chargeLine, chargeLineCode, planCharge } from "./charge-line";

describe("planCharge", () => {
  it("keeps an additional charge as entered", () => {
    expect(planCharge({ kind: "ADDITIONAL", amountCents: 15000, note: "Smoking fee", tollDays: 0, adminFeeCentsPerDay: 500 })).toEqual({ kind: "ADDITIONAL", amountCents: 15000, note: "Smoking fee", lineCode: "charge.additional", toll: false });
  });

  it("adds toll handling and files it as an additional payment", () => {
    expect(planCharge({ kind: "TOLL", amountCents: 12350, note: "FasTrak", tollDays: 3, adminFeeCentsPerDay: 500 })).toEqual({ kind: "ADDITIONAL", amountCents: 13850, note: "Tolls $123.50 · 3 day(s) handling $15 · FasTrak", lineCode: "charge.toll", toll: true });
    expect(planCharge({ kind: "TOLL", amountCents: 800, note: "", tollDays: 1, adminFeeCentsPerDay: 500 }).note).toBe("Tolls $8 · 1 day(s) handling $5");
  });

  it("settles recorded fees as an additional payment without a new line", () => {
    expect(planCharge({ kind: "SETTLE", amountCents: 8000, note: "Fees", tollDays: 0, adminFeeCentsPerDay: 500 })).toEqual({ kind: "ADDITIONAL", amountCents: 8000, note: "Fees", lineCode: null, toll: false });
    expect(chargeLineCode("SETTLE")).toBeNull();
  });

  it("writes no line for a rental charge and a cancellation line for a cancellation fee", () => {
    expect(planCharge({ kind: "RENTAL", amountCents: 20000, note: "Balance", tollDays: 0, adminFeeCentsPerDay: 500 })).toMatchObject({ kind: "RENTAL", lineCode: null, toll: false, amountCents: 20000 });
    expect(planCharge({ kind: "CANCELLATION_FEE", amountCents: 10000, note: "Late cancel", tollDays: 5, adminFeeCentsPerDay: 500 })).toMatchObject({ kind: "CANCELLATION_FEE", lineCode: "charge.cancellation", amountCents: 10000 });
  });
});

describe("approvedCharge", () => {
  it("uses the line recorded with the request", () => {
    expect(approvedCharge({ intent: "charge", kind: "ADDITIONAL", lineCode: "charge.toll", toll: true, tollDays: 2 })).toEqual({ kind: "ADDITIONAL", lineCode: "charge.toll", toll: true });
    expect(approvedCharge({ intent: "charge", kind: "CANCELLATION_FEE", lineCode: "charge.cancellation", toll: false })).toEqual({ kind: "CANCELLATION_FEE", lineCode: "charge.cancellation", toll: false });
  });

  it("works out the line for requests saved before lines were recorded", () => {
    expect(approvedCharge({ intent: "charge", kind: "ADDITIONAL" })).toEqual({ kind: "ADDITIONAL", lineCode: "charge.additional", toll: false });
    expect(approvedCharge({ intent: "charge" })).toEqual({ kind: "ADDITIONAL", lineCode: "charge.additional", toll: false });
  });

  it("writes no line when the request recorded that none is wanted", () => {
    expect(approvedCharge({ intent: "charge", kind: "ADDITIONAL", lineCode: null, toll: false })).toEqual({ kind: "ADDITIONAL", lineCode: null, toll: false });
  });

  it("writes no line for rental charges or damage claims", () => {
    expect(approvedCharge({ intent: "charge", kind: "RENTAL", lineCode: "charge.additional" })).toEqual({ kind: "RENTAL", lineCode: null, toll: false });
    expect(approvedCharge({ intent: "charge", kind: "ADDITIONAL", claimId: "c1" })).toEqual({ kind: "ADDITIONAL", lineCode: null, toll: false });
  });

  it("ignores a line code that is not a charge line", () => {
    expect(approvedCharge({ kind: "ADDITIONAL", lineCode: "rental.daily" }).lineCode).toBe("charge.additional");
    expect(approvedCharge({ kind: "ADDITIONAL", lineCode: 7 }).lineCode).toBe("charge.additional");
  });
});

describe("chargeLine", () => {
  it("builds an untaxed additional line", () => {
    expect(chargeLine("r1", { lineCode: "charge.toll", amountCents: 13850, note: "Tolls" })).toEqual({ reservation_id: "r1", type: "ADDITIONAL", code: "charge.toll", description: "Tolls", quantity: 1, unit_cents: 13850, amount_cents: 13850, taxable: false, sort_order: 300 });
    expect(chargeLineCode("RENTAL")).toBeNull();
  });
});
