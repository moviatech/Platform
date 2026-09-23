import { describe, expect, it } from "vitest";
import { disputeLostTargets, payoutArrivalTargets, stripeTargets, type StripeTxn } from "./stripe-targets";
import type { PostingItem, Target } from "./types";

const txn = (overrides: Partial<StripeTxn>): StripeTxn => ({ id: "txn", livemode: true, type: "charge", category: "charge", amount_cents: 0, fee_cents: 0, net_cents: 0, currency: "usd", payment_intent_id: null, created_at: "2026-11-17T19:23:00Z", ...overrides });

const november = [
  txn({ id: "txn_3UcryWL3SQbfuVSq1YxpCdvn", amount_cents: 100, fee_cents: 33, net_cents: 67, payment_intent_id: "pi_a" }),
  txn({ id: "txn_3UcryWL3SQbfuVSq180qZsfQ", type: "refund", category: "refund", amount_cents: -100, net_cents: -100, payment_intent_id: "pi_a" }),
  txn({ id: "txn_3UcsNpL3SQbfuVSq03KuYmqI", amount_cents: 100, fee_cents: 33, net_cents: 67, payment_intent_id: "pi_b", created_at: "2026-11-17T19:49:00Z" }),
  txn({ id: "txn_3UcsNpL3SQbfuVSq0CEs1VHi", type: "refund", category: "refund", amount_cents: -100, net_cents: -100, payment_intent_id: "pi_b", created_at: "2026-11-17T19:49:00Z" }),
];

const balances = (items: PostingItem[], by: (target: Target) => string = (target) => target.account) => {
  const totals: Record<string, number> = {};
  for (const target of items.flatMap((entry) => entry.targets)) totals[by(target)] = (totals[by(target)] ?? 0) + target.amount;
  return totals;
};

describe("stripeTargets", () => {
  it("books the four November 17 self-test transactions as the plan expects", () => {
    const items = november.flatMap((row) => stripeTargets(row, null).items);
    expect(items.map((entry) => entry.source_key)).toEqual(november.map((row) => `stripe:${row.id}`));
    expect(items.every((entry) => entry.economic_date === "2026-11-17")).toBe(true);
    const totals = balances(items);
    expect(totals["1050"]).toBe(-66);
    expect(totals["5030"]).toBe(66);
    expect(totals["2190"]).toBe(0);
    const byIntent = balances(items.map((entry) => ({ ...entry, targets: entry.targets.filter((target) => target.account === "2190") })), (target) => target.stripe_id ?? "");
    expect(byIntent).toEqual({ pi_a: 0, pi_b: 0 });
  });

  it("credits the order's customer account for a charge and debits it for a refund", () => {
    const order = { reservationId: "res-1", included: true, vehicleId: "veh-1", locationId: "loc-1" };
    const charge = stripeTargets(txn({ id: "c1", amount_cents: 197900, fee_cents: 5769, net_cents: 192131, payment_intent_id: "pi_1" }), order).items[0];
    expect(charge.targets).toEqual([
      { account: "1050", amount: 192131 },
      { account: "1100", amount: -197900, reservation_id: "res-1", vehicle_id: "veh-1", location_id: "loc-1", stripe_id: "pi_1" },
      { account: "5030", amount: 5769, reservation_id: "res-1", vehicle_id: "veh-1", location_id: "loc-1", stripe_id: "pi_1" },
    ]);
    const refund = stripeTargets(txn({ id: "r1", type: "payment_refund", category: "refund", amount_cents: -5000, net_cents: -5000, payment_intent_id: "pi_1" }), order).items[0];
    expect(balances([refund])).toEqual({ "1050": -5000, "1100": 5000 });
  });

  it("uses test-order clearing when the order is not in the books", () => {
    const order = { reservationId: "res-test", included: false, vehicleId: null, locationId: null };
    const built = stripeTargets(txn({ id: "c2", amount_cents: 100, fee_cents: 33, net_cents: 67, payment_intent_id: "pi_t" }), order);
    expect(balances(built.items)).toEqual({ "1050": 67, "2910": -100, "5030": 33 });
    expect(built.items[0].targets.find((target) => target.account === "5030")).toEqual({ account: "5030", amount: 33 });
    expect(stripeTargets(november[0], null).items[0].targets.find((target) => target.account === "5030")).toEqual({ account: "5030", amount: 33 });
  });

  it("books disputes, payouts and Stripe fees against their own accounts", () => {
    expect(balances(stripeTargets(txn({ id: "d1", type: "adjustment", category: "dispute", amount_cents: -10000, fee_cents: 1500, net_cents: -11500 }), null).items)).toEqual({ "1050": -11500, "1150": 10000, "5045": 1500 });
    expect(balances(stripeTargets(txn({ id: "d2", type: "adjustment", category: "dispute_reversal", amount_cents: 10000, fee_cents: -1500, net_cents: 11500 }), null).items)).toEqual({ "1050": 11500, "1150": -10000, "5045": -1500 });
    expect(balances(stripeTargets(txn({ id: "p1", type: "payout", category: "payout", amount_cents: -50000, net_cents: -50000 }), null).items)).toEqual({ "1050": -50000, "1060": 50000 });
    expect(balances(stripeTargets(txn({ id: "p2", type: "payout_failure", category: "payout_reversal", amount_cents: 50000, net_cents: 50000 }), null).items)).toEqual({ "1050": 50000, "1060": -50000 });
    expect(balances(stripeTargets(txn({ id: "f1", type: "stripe_fee", category: "fee", amount_cents: -199, net_cents: -199 }), null).items)).toEqual({ "1050": -199, "5030": 199 });
  });

  it("puts unknown categories into suspense and flags them", () => {
    const built = stripeTargets(txn({ id: "x1", type: "topup", category: "topup", amount_cents: 2000, net_cents: 2000 }), null);
    expect(balances(built.items)).toEqual({ "1050": 2000, "2900": -2000 });
    expect(built.issues.map((issue) => issue.kind)).toEqual(["stripe_unknown_category"]);
  });

  it("ignores test mode and flags other currencies", () => {
    expect(stripeTargets(txn({ id: "t1", livemode: false, amount_cents: 100, net_cents: 100 }), null)).toEqual({ items: [], issues: [] });
    const foreign = stripeTargets(txn({ id: "e1", currency: "eur", amount_cents: 100, net_cents: 100 }), null);
    expect(foreign.items).toEqual([]);
    expect(foreign.issues.map((issue) => issue.kind)).toEqual(["stripe_currency"]);
  });

  it("every Stripe posting is balanced", () => {
    for (const row of [...november, txn({ id: "z", category: "dispute", amount_cents: -100, fee_cents: 1500, net_cents: -1600 })]) {
      for (const entry of stripeTargets(row, null).items) expect(entry.targets.reduce((sum, target) => sum + target.amount, 0)).toBe(0);
    }
  });
});

describe("payouts and disputes", () => {
  it("moves a paid payout from transit to the bank clearing account on its calendar arrival day", () => {
    const built = payoutArrivalTargets({ id: "po_1", livemode: true, status: "paid", amount_cents: 50000, arrival_date: "2026-12-22T00:00:00Z", created_at: "2026-12-20T03:00:00Z" });
    expect(built.items[0]).toMatchObject({ source_key: "payout:po_1", economic_date: "2026-12-22" });
    expect(balances(built.items)).toEqual({ "1080": 50000, "1060": -50000 });
    const transit = payoutArrivalTargets({ id: "po_2", livemode: true, status: "in_transit", amount_cents: 50000, arrival_date: "2026-12-22T00:00:00Z", created_at: "2026-12-20T03:00:00Z" });
    expect(transit.items.map((entry) => [entry.source_key, entry.targets.length])).toEqual([["payout:po_2", 0]]);
    expect(payoutArrivalTargets({ id: "po_3", livemode: false, status: "paid", amount_cents: 50000, arrival_date: "2026-12-22T00:00:00Z", created_at: "2026-12-20T03:00:00Z" }).items).toEqual([]);
  });

  it("writes a lost dispute off to chargeback losses", () => {
    const built = disputeLostTargets({ disputeId: "dp_1", amountCents: 10000, at: "2027-02-10T18:00:00Z", reservationId: "res-1" });
    expect(built.items[0]).toMatchObject({ source_key: "dispute:dp_1:outcome", economic_date: "2027-02-10" });
    expect(balances(built.items)).toEqual({ "5040": 10000, "1150": -10000 });
  });
});
