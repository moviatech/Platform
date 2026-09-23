import { describe, expect, it } from "vitest";
import { chunk, damageNets, ledgerShareByOrder, planPostings, reversalDate, vehicleAllocation, withdrawalsFromEarnings, type PostedRow } from "./assemble";
import type { OwnerEntry } from "./other-targets";
import type { StripeTxn } from "./stripe-targets";
import { item } from "./types";

const row = (overrides: Partial<PostedRow>): PostedRow => ({ source_key: "k", source_id: "s", account: "1100", reservation_id: null, vehicle_id: null, location_id: null, investor_id: null, expense_id: null, stripe_id: null, revenue_class: null, balance: 0, ...overrides });

describe("planPostings", () => {
  const built = [
    item({ sourceType: "reservation", sourceId: "r1", key: "order:r1:rec:2026-12", date: "2026-12-31", targets: [{ account: "1100", amount: 100, reservation_id: "r1" }, { account: "4010", amount: -100, reservation_id: "r1", revenue_class: "RENTAL" }] }),
    item({ sourceType: "expense", sourceId: "e1", key: "expense:e1", date: "2026-11-03", targets: [{ account: "6110", amount: 500, expense_id: "e1" }, { account: "1080", amount: -500, expense_id: "e1" }] }),
  ];

  it("posts new keys and skips keys whose balances already match", () => {
    const fresh = planPostings({ built, posted: [], reversible: () => true, today: "2027-01-05" });
    expect(fresh.toPost.map((entry) => [entry.source_key, entry.reason])).toEqual([["order:r1:rec:2026-12", "NEW"], ["expense:e1", "NEW"]]);
    const posted = [
      row({ source_key: "order:r1:rec:2026-12", source_id: "r1", account: "1100", reservation_id: "r1", balance: 100 }),
      row({ source_key: "order:r1:rec:2026-12", source_id: "r1", account: "4010", reservation_id: "r1", revenue_class: "RENTAL", balance: -100 }),
      row({ source_key: "expense:e1", source_id: "e1", account: "6110", expense_id: "e1", balance: 500 }),
      row({ source_key: "expense:e1", source_id: "e1", account: "1080", expense_id: "e1", balance: -500 }),
    ];
    expect(planPostings({ built, posted, reversible: () => true, today: "2027-01-05" })).toEqual({ toPost: [], unchanged: 2, reversals: 0 });
  });

  it("labels changes and reversals and reverses vanished keys only when allowed", () => {
    const posted = [
      row({ source_key: "order:r1:rec:2026-12", source_id: "r1", account: "1100", reservation_id: "r1", balance: 90 }),
      row({ source_key: "order:r1:rec:2026-12", source_id: "r1", account: "4010", reservation_id: "r1", revenue_class: "RENTAL", balance: -90 }),
      row({ source_key: "order:gone:addl:2026-12-05", source_id: "gone", account: "1100", balance: 50 }),
      row({ source_key: "order:gone:addl:2026-12-05", source_id: "gone", account: "4090", balance: -50 }),
      row({ source_key: "order:kept:start", source_id: "kept", account: "1100", balance: 10 }),
      row({ source_key: "order:kept:start", source_id: "kept", account: "4040", balance: -10 }),
    ];
    const plan = planPostings({ built: [built[0], { ...built[1], targets: [] }], posted, reversible: (key) => key.includes("gone"), today: "2027-01-05" });
    expect(plan.toPost.map((entry) => [entry.source_key, entry.reason, entry.targets.length, entry.economic_date])).toEqual([
      ["order:r1:rec:2026-12", "NEW", 2, "2026-12-31"],
      ["order:gone:addl:2026-12-05", "SOURCE_DELETED", 0, "2026-12-05"],
    ]);
    expect(plan).toMatchObject({ unchanged: 1, reversals: 1 });
    expect(plan.toPost[1].source_type).toBe("reservation");
  });

  it("calls a month's recognition that only grew new, and a shrink or move a reprice", () => {
    const posted = [
      row({ source_key: "order:r1:rec:2026-12", source_id: "r1", account: "1100", reservation_id: "r1", balance: 60 }),
      row({ source_key: "order:r1:rec:2026-12", source_id: "r1", account: "4010", reservation_id: "r1", revenue_class: "RENTAL", balance: -60 }),
    ];
    const reasonFor = (amount: number) => planPostings({ built: [{ ...built[0], targets: [{ account: "1100", amount, reservation_id: "r1" }, { account: "4010", amount: -amount, reservation_id: "r1", revenue_class: "RENTAL" }] }], posted, reversible: () => false, today: "2027-01-05" }).toPost[0]?.reason;
    expect(reasonFor(100)).toBe("NEW");
    expect(reasonFor(40)).toBe("REPRICE");
  });

  it("refuses two items for the same key", () => {
    expect(() => planPostings({ built: [built[0], built[0]], posted: [], reversible: () => true, today: "2027-01-05" })).toThrow("duplicate_key:order:r1:rec:2026-12");
  });

  it("dates reversals from the key, never later than today", () => {
    expect(reversalDate("order:r1:rec:2026-12", "2027-01-05")).toBe("2026-12-31");
    expect(reversalDate("order:r1:addl:2026-12-05", "2027-01-05")).toBe("2026-12-05");
    expect(reversalDate("order:r1:rec:2027-01", "2027-01-05")).toBe("2027-01-05");
    expect(reversalDate("stripe:txn_1", "2027-01-05")).toBe("2027-01-05");
  });

  it("splits batches", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([], 50)).toEqual([]);
  });
});

const entry = (overrides: Partial<OwnerEntry>): OwnerEntry => ({ id: "e", investor_id: "inv", type: "RENTAL_SHARE", bucket: "PENDING", amount_cents: 0, reservation_id: null, vehicle_id: null, statement_id: null, reversal_of: null, metadata: null, created_at: "2027-01-01T00:00:00Z", ...overrides });

describe("owner ledger summaries", () => {
  it("sums each owner's unreversed share per order", () => {
    const entries = [
      entry({ id: "a", amount_cents: 110084, reservation_id: "r1" }),
      entry({ id: "b", type: "ADJUSTMENT", amount_cents: -3000, reservation_id: "r1" }),
      entry({ id: "c", type: "REVERSAL", amount_cents: -110084, reservation_id: "r1", reversal_of: "a" }),
      entry({ id: "d", amount_cents: 5000, reservation_id: "r2" }),
      entry({ id: "e", type: "MILEAGE_FEE", amount_cents: 9999, statement_id: "s" }),
    ];
    expect(Object.fromEntries(ledgerShareByOrder(entries))).toEqual({ "inv:r1": -3000, "inv:r2": 5000 });
  });

  it("knows how much of each withdrawal came from earnings, and gives it back when a withdrawal is reversed", () => {
    const entries = [
      entry({ id: "s1", amount_cents: 100000, reservation_id: "r1", created_at: "2027-01-10T00:00:00Z" }),
      entry({ id: "w1", type: "WITHDRAWAL", bucket: "PAID_OUT", amount_cents: 60000, created_at: "2027-01-20T00:00:00Z" }),
      entry({ id: "w2", type: "WITHDRAWAL", bucket: "PAID_OUT", amount_cents: 60000, created_at: "2027-01-25T00:00:00Z" }),
      entry({ id: "h1", type: "WITHHELD", bucket: "AVAILABLE", amount_cents: -60000, created_at: "2027-01-19T00:00:00Z" }),
      entry({ id: "x1", type: "REVERSAL", bucket: "PAID_OUT", amount_cents: -60000, reversal_of: "w2", created_at: "2027-01-28T00:00:00Z" }),
      entry({ id: "w3", type: "WITHDRAWAL", bucket: "PAID_OUT", amount_cents: 50000, created_at: "2027-01-30T00:00:00Z" }),
    ];
    expect(Object.fromEntries(withdrawalsFromEarnings(entries))).toEqual({ w1: 60000, w2: 40000, x1: -40000, w3: 40000 });
  });
});

describe("damage and vehicles", () => {
  const txn = (overrides: Partial<StripeTxn>): StripeTxn => ({ id: "t", livemode: true, type: "charge", category: "charge", amount_cents: 0, fee_cents: 0, net_cents: 0, currency: "usd", payment_intent_id: null, created_at: "2027-01-22T18:00:00Z", ...overrides });

  it("nets a damage claim's live charges and refunds", () => {
    const txns = [txn({ id: "t1", amount_cents: 45000, payment_intent_id: "pi_d" }), txn({ id: "t2", type: "refund", category: "refund", amount_cents: -5000, payment_intent_id: "pi_d", created_at: "2027-01-25T18:00:00Z" }), txn({ id: "t3", livemode: false, amount_cents: 999, payment_intent_id: "pi_d" })];
    expect(damageNets([{ id: "c1", reservation_id: "r1", payment_id: "p1" }, { id: "c2", reservation_id: "r1", payment_id: null }], new Map([["p1", "pi_d"]]), txns)).toEqual([{ claimId: "c1", reservationId: "r1", netCents: 40000, date: "2027-01-22" }]);
  });

  it("finds the allocation covering a car on a date", () => {
    const allocations = [
      { id: "a1", investor_id: "inv", vehicle_id: "v1", share_bps: 7000, revenue_share_bps: 10000, effective_from: "2026-11-19", effective_to: null, compensation: "REVENUE_SHARE" },
      { id: "a2", investor_id: "inv", vehicle_id: "v2", share_bps: 7000, revenue_share_bps: 10000, effective_from: "2027-02-01", effective_to: null, compensation: "REVENUE_SHARE" },
    ];
    expect(vehicleAllocation("v1", allocations, "2026-12-19")?.id).toBe("a1");
    expect(vehicleAllocation("v2", allocations, "2026-12-19")).toBeNull();
    expect(vehicleAllocation(null, allocations, "2026-12-19")).toBeNull();
  });
});
