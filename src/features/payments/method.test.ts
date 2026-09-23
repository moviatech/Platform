import { describe, expect, it } from "vitest";
import { isOfflineMethod, offlineDueLeft, paymentMethod, planCancellationRefunds, refundMethod } from "./method";

describe("paymentMethod", () => {
  it("names the offline method, or card for anything that went through Stripe", () => {
    expect(paymentMethod({ offline_method: "CASH", stripe_payment_intent_id: null })).toBe("CASH");
    expect(paymentMethod({ offline_method: null, stripe_payment_intent_id: "pi_1" })).toBe("CARD");
    expect(paymentMethod({ offline_method: null, stripe_payment_intent_id: null, stripe_checkout_session_id: "cs_1" })).toBe("CARD");
    expect(paymentMethod({ offline_method: null, stripe_payment_intent_id: null })).toBe("");
  });
});

describe("refundMethod", () => {
  it("is empty when nothing was refunded", () => {
    expect(refundMethod({ offline_method: "CASH", stripe_payment_intent_id: null, amount_refunded_cents: 0, refunds: [] })).toBe("");
  });

  it("is card for a Stripe payment even without a refund row", () => {
    expect(refundMethod({ offline_method: null, stripe_payment_intent_id: "pi_1", amount_refunded_cents: 500, refunds: [] })).toBe("CARD");
  });

  it("lists each way an offline payment was given back once, ignoring refunds that did not go through", () => {
    const refunds = [
      { status: "SUCCEEDED", offline_method: "CASH" },
      { status: "SUCCEEDED", offline_method: "ZELLE" },
      { status: "SUCCEEDED", offline_method: "CASH" },
      { status: "FAILED", offline_method: "TRANSFER" },
    ];
    expect(refundMethod({ offline_method: "CASH", stripe_payment_intent_id: null, amount_refunded_cents: 9000, refunds })).toBe("CASH/ZELLE");
  });
});

describe("isOfflineMethod", () => {
  it("accepts only the four known methods", () => {
    expect(isOfflineMethod("ZELLE")).toBe(true);
    expect(isOfflineMethod("CARD")).toBe(false);
    expect(isOfflineMethod(undefined)).toBe(false);
  });
});

describe("planCancellationRefunds", () => {
  const card = (id: string, captured: number, refunded = 0) => ({ id, amount_captured_cents: captured, amount_refunded_cents: refunded, offline_method: null });
  const cash = (id: string, captured: number, refunded = 0) => ({ id, amount_captured_cents: captured, amount_refunded_cents: refunded, offline_method: "CASH" });

  it("refunds card payments in full when there is no fee", () => {
    expect(planCancellationRefunds([card("a", 20000), card("b", 5000)], 0)).toEqual({ refunds: [{ paymentId: "a", amountCents: 20000 }, { paymentId: "b", amountCents: 5000 }], offlineDueCents: 0, offlineKeptCents: 0, feeRemaining: 0 });
  });

  it("keeps the fee from the earliest money and refunds the rest", () => {
    expect(planCancellationRefunds([card("a", 20000, 5000)], 10000)).toEqual({ refunds: [{ paymentId: "a", amountCents: 5000 }], offlineDueCents: 0, offlineKeptCents: 0, feeRemaining: 0 });
  });

  it("never sends an offline payment to the card processor and reports what is owed back by hand", () => {
    expect(planCancellationRefunds([cash("a", 30000)], 10000)).toEqual({ refunds: [], offlineDueCents: 20000, offlineKeptCents: 10000, feeRemaining: 0 });
  });

  it("still refunds the card part of an order paid both ways", () => {
    expect(planCancellationRefunds([cash("a", 8000), card("b", 30000)], 10000)).toEqual({ refunds: [{ paymentId: "b", amountCents: 28000 }], offlineDueCents: 0, offlineKeptCents: 8000, feeRemaining: 0 });
    expect(planCancellationRefunds([card("a", 8000), cash("b", 30000)], 5000)).toEqual({ refunds: [{ paymentId: "a", amountCents: 3000 }], offlineDueCents: 30000, offlineKeptCents: 0, feeRemaining: 0 });
  });

  it("reports the part of the fee that the money on hand does not cover", () => {
    expect(planCancellationRefunds([cash("a", 4000), card("b", 2000, 2000)], 10000)).toEqual({ refunds: [], offlineDueCents: 0, offlineKeptCents: 4000, feeRemaining: 6000 });
  });
});

describe("offlineDueLeft", () => {
  const cash = (captured: number, refunded: number) => ({ kind: "RENTAL", amount_captured_cents: captured, amount_refunded_cents: refunded, offline_method: "CASH" });
  const settlement = { offlineDueCents: 20000, offlineKeptCents: 10000 };

  it("is the full amount until a refund is recorded, then what is left, then nothing", () => {
    expect(offlineDueLeft([cash(30000, 0)], settlement)).toBe(20000);
    expect(offlineDueLeft([cash(30000, 5000)], settlement)).toBe(15000);
    expect(offlineDueLeft([cash(30000, 20000)], settlement)).toBe(0);
    expect(offlineDueLeft([cash(30000, 30000)], settlement)).toBe(0);
  });

  it("ignores card payments, other kinds and settlements that owed nothing", () => {
    expect(offlineDueLeft([cash(30000, 0), { kind: "RENTAL", amount_captured_cents: 9000, amount_refunded_cents: 0, offline_method: null }, { kind: "ADDITIONAL", amount_captured_cents: 7000, amount_refunded_cents: 0, offline_method: "CASH" }], settlement)).toBe(20000);
    expect(offlineDueLeft([cash(30000, 0)], { offlineDueCents: 0, offlineKeptCents: 30000 })).toBe(0);
    expect(offlineDueLeft([cash(30000, 0)], null)).toBe(0);
  });

  it("never asks for more than the settlement did", () => {
    expect(offlineDueLeft([cash(30000, 0), cash(5000, 0)], settlement)).toBe(20000);
  });
});
