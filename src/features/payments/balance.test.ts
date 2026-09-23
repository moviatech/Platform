import { describe, expect, it } from "vitest";
import { checkoutCurrent, claimHeld, orderBalance, orderDues } from "./balance";

const rental = (id: string, captured: number, refunded = 0) => ({ id, kind: "RENTAL", amount_captured_cents: captured, amount_refunded_cents: refunded });
const extra = (id: string, captured: number, refunded = 0) => ({ id, kind: "ADDITIONAL", amount_captured_cents: captured, amount_refunded_cents: refunded });
const hold = (id: string, captured: number) => ({ id, kind: "SECURITY_HOLD", amount_captured_cents: captured, amount_refunded_cents: 0 });
const line = (code: string, amount_cents: number, type = "ADDITIONAL") => ({ type, code, amount_cents });

describe("checkoutCurrent", () => {
  it("keeps a card link usable whatever is owed", () => {
    expect(checkoutCurrent(0, false, 197900)).toBe(true);
    expect(checkoutCurrent(0, true, 0)).toBe(true);
    expect(checkoutCurrent(0, true, 50000)).toBe(true);
  });

  it("keeps a payment link only while it asks for exactly what is owed on a pay-now order", () => {
    expect(checkoutCurrent(50000, true, 50000)).toBe(true);
    expect(checkoutCurrent(50000, true, 30000)).toBe(false);
    expect(checkoutCurrent(50000, true, 0)).toBe(false);
    expect(checkoutCurrent(50000, true, -100)).toBe(false);
    expect(checkoutCurrent(50000, false, 50000)).toBe(false);
  });
});

describe("orderBalance", () => {
  it("is the unpaid rent when there are no extras", () => {
    expect(orderBalance({ totalCents: 50000, lines: [line("rental.daily", 50000, "RENTAL")], payments: [rental("p1", 20000)], claimPaymentIds: [] })).toBe(30000);
    expect(orderBalance({ totalCents: 50000, lines: [], payments: [rental("p1", 50000)], claimPaymentIds: [] })).toBe(0);
    expect(orderBalance({ totalCents: 40000, lines: [], payments: [rental("p1", 50000)], claimPaymentIds: [] })).toBe(-10000);
  });

  it("adds extras that were never charged", () => {
    expect(orderBalance({ totalCents: 20000, lines: [line("fee.late", 5000), line("fee.tax", 400)], payments: [rental("p1", 20000)], claimPaymentIds: [] })).toBe(5400);
  });

  it("does not let an extra charge pay for rent", () => {
    expect(orderBalance({ totalCents: 39200, lines: [line("charge.additional", 5000)], payments: [rental("p1", 29400), extra("p2", 5000)], claimPaymentIds: [] })).toBe(9800);
    expect(orderBalance({ totalCents: 30000, lines: [], payments: [extra("p2", 15000)], claimPaymentIds: [] })).toBe(30000);
  });

  it("does not bring back an extra charge that was refunded", () => {
    expect(orderBalance({ totalCents: 20000, lines: [line("charge.additional", 5000)], payments: [rental("p1", 20000), extra("p2", 5000, 5000)], claimPaymentIds: [] })).toBe(0);
    expect(orderBalance({ totalCents: 20000, lines: [line("charge.toll", 5000)], payments: [rental("p1", 20000), extra("p2", 5000, 2000)], claimPaymentIds: [] })).toBe(0);
  });

  it("still owes rent that was refunded", () => {
    expect(orderBalance({ totalCents: 20000, lines: [], payments: [rental("p1", 20000, 5000)], claimPaymentIds: [] })).toBe(5000);
  });

  it("leaves damage claims, cancellation fees and manual lines out", () => {
    expect(orderBalance({ totalCents: 20000, lines: [line("fee.late", 5000)], payments: [rental("p1", 20000), extra("claim", 30000)], claimPaymentIds: ["claim"] })).toBe(5000);
    expect(orderBalance({ totalCents: 20000, lines: [line("charge.cancellation", 15000)], payments: [rental("p1", 20000), { id: "p3", kind: "CANCELLATION_FEE", amount_captured_cents: 15000, amount_refunded_cents: 0 }], claimPaymentIds: [] })).toBe(0);
    expect(orderBalance({ totalCents: 21000, lines: [line("manual.fee", 1000)], payments: [rental("p1", 21000)], claimPaymentIds: [] })).toBe(0);
  });

  it("counts a captured deposit toward extras, never toward rent", () => {
    expect(orderBalance({ totalCents: 20000, lines: [line("fee.late", 8000)], payments: [rental("p1", 20000), extra("p2", 0), hold("h1", 8000)], claimPaymentIds: [] })).toBe(0);
    expect(orderBalance({ totalCents: 20000, lines: [line("fee.late", 30000)], payments: [rental("p1", 20000), hold("h1", 20000)], claimPaymentIds: [] })).toBe(10000);
    expect(orderBalance({ totalCents: 20000, lines: [line("fee.late", 8000)], payments: [rental("p1", 20000), hold("h1", 0)], claimPaymentIds: [] })).toBe(8000);
    expect(orderBalance({ totalCents: 30000, lines: [], payments: [hold("h1", 20000)], claimPaymentIds: [] })).toBe(30000);
    expect(orderBalance({ totalCents: 20000, lines: [], payments: [rental("p1", 20000), hold("h1", 30000)], claimPaymentIds: [] })).toBe(0);
  });

  it("does not let deposit money taken for a damage claim cover fees", () => {
    const payments = [rental("p1", 20000), hold("h1", 30000)];
    expect(claimHeld(payments, [{ payment_id: "h1", amount_cents: 30000 }, { payment_id: "p1", amount_cents: 1000 }, { payment_id: null, amount_cents: 500 }])).toBe(30000);
    expect(orderDues({ totalCents: 20000, lines: [line("fee.late", 5000)], payments, claimPaymentIds: ["h1"], claimHeldCents: 30000 })).toEqual({ rentDueCents: 0, extrasDueCents: 5000, balanceCents: 5000 });
    expect(orderDues({ totalCents: 20000, lines: [line("fee.late", 5000)], payments: [rental("p1", 20000), hold("h1", 34000)], claimPaymentIds: ["h1"], claimHeldCents: 30000 })).toEqual({ rentDueCents: 0, extrasDueCents: 1000, balanceCents: 1000 });
    expect(orderDues({ totalCents: 20000, lines: [line("fee.late", 5000)], payments, claimPaymentIds: [] })).toEqual({ rentDueCents: 0, extrasDueCents: 0, balanceCents: 0 });
  });

  it("splits what is owed into rent and recorded fees", () => {
    expect(orderDues({ totalCents: 50000, lines: [line("fee.late", 8000)], payments: [rental("p1", 20000)], claimPaymentIds: [] })).toEqual({ rentDueCents: 30000, extrasDueCents: 8000, balanceCents: 38000 });
    expect(orderDues({ totalCents: 20000, lines: [line("fee.late", 8000)], payments: [rental("p1", 20000)], claimPaymentIds: [] })).toEqual({ rentDueCents: 0, extrasDueCents: 8000, balanceCents: 8000 });
    expect(orderDues({ totalCents: 20000, lines: [line("fee.late", 8000)], payments: [rental("p1", 25000)], claimPaymentIds: [] })).toEqual({ rentDueCents: -5000, extrasDueCents: 3000, balanceCents: 3000 });
    expect(orderDues({ totalCents: 20000, lines: [line("fee.late", 8000)], payments: [rental("p1", 30000)], claimPaymentIds: [] })).toEqual({ rentDueCents: -10000, extrasDueCents: 0, balanceCents: -2000 });
    expect(orderDues({ totalCents: 20000, lines: [line("fee.late", 8000)], payments: [rental("p1", 20000), extra("p2", 8000)], claimPaymentIds: [] })).toEqual({ rentDueCents: 0, extrasDueCents: 0, balanceCents: 0 });
  });

  it("shows an extra payment with no charge behind it as money to return once rent is settled", () => {
    expect(orderBalance({ totalCents: 20000, lines: [], payments: [rental("p1", 20000), extra("stray", 30000), extra("claim", 30000)], claimPaymentIds: ["claim"] })).toBe(-30000);
    expect(orderBalance({ totalCents: 20000, lines: [], payments: [rental("p1", 20000), extra("stray", 30000, 30000)], claimPaymentIds: [] })).toBe(0);
    expect(orderBalance({ totalCents: 20000, lines: [], payments: [rental("p1", 5000), extra("stray", 30000)], claimPaymentIds: [] })).toBe(15000);
    expect(orderBalance({ totalCents: 20000, lines: [line("charge.additional", 5000)], payments: [rental("p1", 20000), extra("p2", 5000), extra("p3", 5000)], claimPaymentIds: [] })).toBe(-5000);
  });
});
