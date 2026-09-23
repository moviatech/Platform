import { describe, expect, it } from "vitest";
import { mapTransaction, reconcile, summarizeStripe } from "./stripe-ledger";

describe("mapTransaction", () => {
  it("keeps the payment intent of a charge and converts timestamps", () => {
    const row = mapTransaction({ id: "txn_1", type: "charge", reporting_category: "charge", amount: 38331, fee: 1142, net: 37189, currency: "usd", status: "available", created: 1794343069, available_on: 1794873600, source: { id: "ch_1", object: "charge", payment_intent: "pi_1" } }, true);
    expect(row).toMatchObject({ id: "txn_1", livemode: true, category: "charge", amount_cents: 38331, fee_cents: 1142, net_cents: 37189, source_id: "ch_1", payment_intent_id: "pi_1" });
    expect(row.created_at).toBe(new Date(1794343069000).toISOString());
    expect(row.available_on).toBe(new Date(1794873600000).toISOString());
  });

  it("reads the payment intent from a refund and copes with a bare source id", () => {
    expect(mapTransaction({ id: "txn_2", type: "refund", reporting_category: "refund", amount: -5000, fee: 0, net: -5000, currency: "usd", status: "available", created: 1, source: { id: "re_1", payment_intent: { id: "pi_2" }, charge: "ch_2" } }, false).payment_intent_id).toBe("pi_2");
    const bare = mapTransaction({ id: "txn_3", type: "stripe_fee", amount: -150, fee: 0, net: -150, currency: "usd", status: "available", created: 1, source: "fee_1" }, false);
    expect(bare.source_id).toBe("fee_1");
    expect(bare.payment_intent_id).toBeNull();
    expect(bare.category).toBe("stripe_fee");
  });
});

describe("summarizeStripe", () => {
  const rows = [
    { category: "charge", amount_cents: 38331, fee_cents: 1142, net_cents: 37189 },
    { category: "charge", amount_cents: 10000, fee_cents: 320, net_cents: 9680 },
    { category: "refund", amount_cents: -5000, fee_cents: 0, net_cents: -5000 },
    { category: "fee", amount_cents: -150, fee_cents: 0, net_cents: -150 },
    { category: "dispute", amount_cents: -2000, fee_cents: 1500, net_cents: -3500 },
    { category: "payout", amount_cents: -30000, fee_cents: 0, net_cents: -30000 },
  ];

  it("adds up charges, refunds, disputes, fees and payouts", () => {
    expect(summarizeStripe(rows)).toEqual({ chargesCents: 48331, refundsCents: 5000, disputesCents: 2000, feesCents: 3112, otherCents: 0, netCents: 38219, payoutsCents: 30000, count: 6 });
  });

  it("net equals charges minus refunds, disputes and fees", () => {
    const summary = summarizeStripe(rows);
    expect(summary.chargesCents - summary.refundsCents - summary.disputesCents - summary.feesCents + summary.otherCents).toBe(summary.netCents);
  });

  it("is zero for no rows", () => {
    expect(summarizeStripe([])).toEqual({ chargesCents: 0, refundsCents: 0, disputesCents: 0, feesCents: 0, otherCents: 0, netCents: 0, payoutsCents: 0, count: 0 });
  });
});

describe("reconcile", () => {
  it("matches by payment intent and reports the three kinds of difference", () => {
    const result = reconcile(
      [
        { id: "ch_1", intent: "pi_1", amountCents: 10000, createdAt: "" },
        { id: "ch_2", intent: "pi_2", amountCents: 20000, createdAt: "" },
        { id: "ch_3", intent: "pi_3", amountCents: 30000, createdAt: "" },
        { id: "ch_4", intent: null, amountCents: 4000, createdAt: "" },
      ],
      [
        { id: "a", intent: "pi_1", capturedCents: 10000, number: "MV-AAAAAA" },
        { id: "b", intent: "pi_2", capturedCents: 25000, number: "MV-BBBBBB" },
        { id: "c", intent: "pi_9", capturedCents: 9000, number: "MV-CCCCCC" },
      ],
    );
    expect(result.matched).toBe(1);
    expect(result.mismatches).toEqual([
      { kind: "MISSING_IN_SYSTEM", reference: "pi_3", stripeCents: 30000, systemCents: null, number: null },
      { kind: "MISSING_IN_SYSTEM", reference: "ch_4", stripeCents: 4000, systemCents: null, number: null },
      { kind: "AMOUNT", reference: "pi_2", stripeCents: 20000, systemCents: 25000, number: "MV-BBBBBB" },
      { kind: "MISSING_IN_STRIPE", reference: "pi_9", stripeCents: null, systemCents: 9000, number: "MV-CCCCCC" },
    ]);
  });

  it("adds up several charges on one payment intent", () => {
    expect(reconcile([{ id: "ch_1", intent: "pi_1", amountCents: 6000, createdAt: "" }, { id: "ch_2", intent: "pi_1", amountCents: 4000, createdAt: "" }], [{ id: "a", intent: "pi_1", capturedCents: 10000, number: null }])).toEqual({ matched: 1, mismatches: [] });
  });
});
