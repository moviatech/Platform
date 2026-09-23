import { describe, expect, it } from "vitest";
import type { Mapping } from "./mapping";
import { amortization, expenseTargets, offlinePaymentTargets, offlineRefundTargets, ownerLedgerTargets, resolutionTargets, settlementTargets, type OwnerEntry } from "./other-targets";
import type { Built } from "./types";

const order = { reservationId: "res-1", included: true, vehicleId: "veh-1", locationId: "loc-1" };
const totals = (built: Built) => {
  const out: Record<string, number> = {};
  for (const target of built.items.flatMap((entry) => entry.targets)) out[target.account] = (out[target.account] ?? 0) + target.amount;
  return out;
};

describe("offline money", () => {
  it("books a cash payment against the order and a refund back", () => {
    const paid = offlinePaymentTargets({ id: "p1", offline_method: "ZELLE", status: "SUCCEEDED", amount_captured_cents: 197900, created_at: "2026-12-19T20:00:00Z" }, order);
    expect(paid.items[0]).toMatchObject({ source_key: "offpay:p1", economic_date: "2026-12-19" });
    expect(totals(paid)).toEqual({ "1070": 197900, "1100": -197900 });
    const back = offlineRefundTargets({ id: "r1", offline_method: "ZELLE", status: "SUCCEEDED", amount_cents: 5000, created_at: "2027-01-02T20:00:00Z" }, order);
    expect(back.items[0]).toMatchObject({ source_key: "offref:r1", economic_date: "2027-01-02" });
    expect(totals(back)).toEqual({ "1100": 5000, "1070": -5000 });
  });

  it("uses the received date, ignores card payments and uncollected rows, and keeps test orders apart", () => {
    expect(offlinePaymentTargets({ id: "p2", offline_method: "CASH", status: "SUCCEEDED", amount_captured_cents: 100, created_at: "2026-12-20T20:00:00Z", received_on: "2026-12-18" }, order).items[0].economic_date).toBe("2026-12-18");
    expect(offlinePaymentTargets({ id: "p3", offline_method: null, status: "SUCCEEDED", amount_captured_cents: 100, created_at: "2026-12-20T20:00:00Z" }, order).items).toEqual([]);
    expect(offlinePaymentTargets({ id: "p4", offline_method: "CASH", status: "PENDING", amount_captured_cents: 100, created_at: "2026-12-20T20:00:00Z" }, order).items.map((entry) => entry.targets)).toEqual([[]]);
    expect(offlineRefundTargets({ id: "r2", offline_method: "CASH", status: "PENDING", amount_cents: 100, created_at: "2026-12-20T20:00:00Z" }, order).items.map((entry) => entry.targets)).toEqual([[]]);
    expect(totals(offlinePaymentTargets({ id: "p5", offline_method: "CASH", status: "REFUNDED", amount_captured_cents: 100, created_at: "2026-12-20T20:00:00Z" }, { ...order, included: false }))).toEqual({ "1070": 100, "2910": -100 });
  });
});

describe("expenses", () => {
  const mappings: Mapping[] = [
    { kind: "EXPENSE", match: "SOFTWARE", account: "6110", mode: "ONCE", version: 1, effective_from: "2026-01-01" },
    { kind: "EXPENSE", match: "MAINTENANCE", account: "6050", mode: "ONCE", version: 1, effective_from: "2026-01-01" },
  ];

  it("books an expense to its account against bank clearing, tagged with the car", () => {
    const built = expenseTargets({ id: "e1", spent_on: "2026-11-03", category: "MAINTENANCE", amount_cents: 18000, vehicle_id: "veh-1", voided_at: null }, mappings, "2026-11-25");
    expect(built.items[0]).toMatchObject({ source_key: "expense:e1", economic_date: "2026-11-03" });
    expect(built.items[0].targets).toEqual([{ account: "6050", amount: 18000, expense_id: "e1", vehicle_id: "veh-1" }, { account: "1080", amount: -18000, expense_id: "e1" }]);
  });

  it("empties a voided expense on its own date and flags an unknown category", () => {
    const voided = expenseTargets({ id: "e2", spent_on: "2026-11-03", category: "SOFTWARE", amount_cents: 56904, vehicle_id: null, voided_at: "2026-11-04T00:00:00Z" }, mappings, "2026-11-25");
    expect(voided.items.map((entry) => [entry.source_key, entry.economic_date, entry.targets.length])).toEqual([["expense:e2", "2026-11-03", 0]]);
    expect(voided.issues).toEqual([]);
    const unknown = expenseTargets({ id: "e3", spent_on: "2026-11-03", category: "LUNCH", amount_cents: 1000, vehicle_id: null, voided_at: null }, mappings, "2026-11-25");
    expect(totals(unknown)).toEqual({ "2900": 1000, "1080": -1000 });
    expect(unknown.issues.map((issue) => issue.kind)).toEqual(["unmapped_expense"]);
  });

  it("credits the account it was paid from and tags the store", () => {
    const card = expenseTargets({ id: "e4", spent_on: "2026-11-05", category: "SOFTWARE", amount_cents: 2000, vehicle_id: null, voided_at: null, location_id: "loc-1", paid_from: "COMPANY_CARD" }, mappings, "2026-11-25");
    expect(card.items[0].targets).toEqual([{ account: "6110", amount: 2000, expense_id: "e4", vehicle_id: null, location_id: "loc-1" }, { account: "2050", amount: -2000, expense_id: "e4" }]);
    expect(totals(expenseTargets({ id: "e5", spent_on: "2026-11-05", category: "SOFTWARE", amount_cents: 2000, vehicle_id: null, voided_at: null, paid_from: "PERSONAL" }, mappings, "2026-11-25"))).toEqual({ "6110": 2000, "2500": -2000 });
    expect(totals(expenseTargets({ id: "e6", spent_on: "2026-11-05", category: "SOFTWARE", amount_cents: 2000, vehicle_id: null, voided_at: null, paid_from: "COMPANY_ACCOUNT" }, mappings, "2026-11-25"))).toEqual({ "6110": 2000, "1080": -2000 });
  });

  it("puts a capital purchase on the balance sheet without asking for a category account", () => {
    const built = expenseTargets({ id: "e7", spent_on: "2026-11-05", category: "OTHER", amount_cents: 450000, vehicle_id: "veh-1", voided_at: null, capital: true, service_from: null, service_to: null }, mappings, "2026-11-25");
    expect(totals(built)).toEqual({ "1500": 450000, "1080": -450000 });
    expect(built.issues).toEqual([]);
  });

  it("spreads a service period over its months by days, only for months that have started", () => {
    const withInsurance: Mapping[] = [...mappings, { kind: "EXPENSE", match: "INSURANCE", account: "6030", mode: "ONCE", version: 1, effective_from: "2026-01-01" }];
    const row = { id: "e8", spent_on: "2026-11-10", category: "INSURANCE", amount_cents: 120000, vehicle_id: "veh-1", voided_at: null, location_id: "loc-1", service_from: "2026-11-15", service_to: "2027-11-14", paid_from: "COMPANY_ACCOUNT" };
    const parts = amortization("2026-11-15", "2027-11-14", 120000);
    expect(parts).toHaveLength(13);
    expect(parts.reduce((sum, part) => sum + part.amount, 0)).toBe(120000);
    expect(parts.every((part, index) => Math.abs(part.amount - (120000 * [16, 31, 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 14][index]) / 365) < 1)).toBe(true);
    const built = expenseTargets(row, withInsurance, "2026-12-05");
    expect(built.items.map((entry) => [entry.source_key, entry.economic_date])).toEqual([
      ["expense:e8", "2026-11-10"],
      ["expense:e8:amort:2026-11", "2026-11-15"],
      ["expense:e8:amort:2026-12", "2026-12-01"],
    ]);
    expect(built.items[0].targets).toEqual([{ account: "1200", amount: 120000, expense_id: "e8" }, { account: "1080", amount: -120000, expense_id: "e8" }]);
    expect(built.items[1].targets).toEqual([{ account: "6030", amount: parts[0].amount, expense_id: "e8", vehicle_id: "veh-1", location_id: "loc-1" }, { account: "1200", amount: -parts[0].amount, expense_id: "e8" }]);
    expect(totals(built)).toEqual({ "1200": 120000 - parts[0].amount - parts[1].amount, "6030": parts[0].amount + parts[1].amount, "1080": -120000 });
    expect(expenseTargets(row, withInsurance, "2026-11-14").items.map((entry) => entry.source_key)).toEqual(["expense:e8"]);
    expect(totals(expenseTargets(row, withInsurance, "2027-12-01"))).toEqual({ "1200": 0, "6030": 120000, "1080": -120000 });
  });

  it("empties every month of a voided spread expense and never spreads a capital purchase", () => {
    const row = { id: "e9", spent_on: "2026-11-10", category: "SOFTWARE", amount_cents: 36000, vehicle_id: null, voided_at: "2026-12-02T00:00:00Z", service_from: "2026-11-01", service_to: "2027-10-31" };
    const voided = expenseTargets(row, mappings, "2026-12-05");
    expect(voided.items.map((entry) => [entry.source_key, entry.targets.length])).toEqual([["expense:e9", 0], ["expense:e9:amort:2026-11", 0], ["expense:e9:amort:2026-12", 0]]);
    expect(amortization("2026-11-03", "2026-11-03", 999)).toEqual([{ month: "2026-11", first: "2026-11-03", amount: 999 }]);
    expect(amortization("2026-11-01", "2026-12-31", 6100)).toEqual([{ month: "2026-11", first: "2026-11-01", amount: 3000 }, { month: "2026-12", first: "2026-12-01", amount: 3100 }]);
  });
});

describe("resolutions", () => {
  const row = { id: "s1", reservation_id: "res-1", category: "ALLOWANCE", amount_cents: 5000, approved_by: null, voided_at: null, created_at: "2027-01-20T20:00:00Z" };

  it("books each category with the plan's accounts", () => {
    const expected: Record<string, Record<string, number>> = {
      INCOME_DAMAGE: { "1100": 5000, "4080": -5000 },
      INCOME_FEES: { "1100": 5000, "4050": -5000 },
      INCOME_OTHER: { "1100": 5000, "4090": -5000 },
      ALLOWANCE: { "4940": 5000, "1100": -5000 },
      BAD_DEBT: { "5050": 5000, "1100": -5000 },
      REFUND_PAYABLE: { "1100": 5000, "2920": -5000 },
    };
    for (const [category, accounts] of Object.entries(expected)) expect(totals(resolutionTargets({ ...row, category }, order))).toEqual(accounts);
    expect(resolutionTargets(row, order).items[0]).toMatchObject({ source_key: "resolution:s1", economic_date: "2027-01-20" });
  });

  it("waits for approval above $100 and empties voided ones", () => {
    const targetsOf = (built: Built) => built.items.map((entry) => entry.targets.length);
    expect(targetsOf(resolutionTargets({ ...row, amount_cents: 10001 }, order))).toEqual([0]);
    expect(targetsOf(resolutionTargets({ ...row, amount_cents: 10001, approved_by: "u2" }, order))).toEqual([2]);
    expect(targetsOf(resolutionTargets({ ...row, amount_cents: 10000 }, order))).toEqual([2]);
    expect(targetsOf(resolutionTargets({ ...row, voided_at: "2027-01-21T00:00:00Z" }, order))).toEqual([0]);
  });
});

describe("owner ledger", () => {
  const entry = (overrides: Partial<OwnerEntry>): OwnerEntry => ({ id: "le", investor_id: "inv-1", type: "RENTAL_SHARE", bucket: "PENDING", amount_cents: 0, reservation_id: null, vehicle_id: "veh-1", statement_id: null, reversal_of: null, metadata: null, created_at: "2027-01-16T20:00:00Z", ...overrides });
  const included = { included: true };

  it("moves a rental share from accrued to earned owner payable", () => {
    const built = ownerLedgerTargets(entry({ id: "le1", amount_cents: 110084, reservation_id: "res-1" }), included);
    expect(built.items[0]).toMatchObject({ source_key: "ownerledger:le1", economic_date: "2027-01-16" });
    expect(totals(built)).toEqual({ "2210": 110084, "2200": -110084 });
    expect(totals(ownerLedgerTargets(entry({ id: "le2", type: "ADJUSTMENT", amount_cents: -3000, reservation_id: "res-1" }), included))).toEqual({ "2210": -3000, "2200": 3000 });
    expect(totals(ownerLedgerTargets(entry({ id: "le3", type: "REVERSAL", amount_cents: -110084, reservation_id: "res-1", reversal_of: "le1" }), included))).toEqual({ "2210": -110084, "2200": 110084 });
  });

  it("books mileage fees as a cost on the last day of the statement month", () => {
    const built = ownerLedgerTargets(entry({ id: "le4", type: "MILEAGE_FEE", amount_cents: 42000, statement_id: "st-1", metadata: { month: "2027-01" }, created_at: "2027-02-03T20:00:00Z" }), included);
    expect(built.items[0].economic_date).toBe("2027-01-31");
    expect(totals(built)).toEqual({ "5020": 42000, "2200": -42000 });
    const adjusted = ownerLedgerTargets(entry({ id: "le5", type: "ADJUSTMENT", amount_cents: -2000, statement_id: "st-1", created_at: "2027-02-10T20:00:00Z" }), { included: true, statementMonth: "2027-01" });
    expect(adjusted.items[0].economic_date).toBe("2027-01-31");
    expect(totals(adjusted)).toEqual({ "5020": -2000, "2200": 2000 });
  });

  it("flags a manual adjustment and its reversal", () => {
    const manual = entry({ id: "le6", type: "ADJUSTMENT", bucket: "AVAILABLE", amount_cents: 2500 });
    const built = ownerLedgerTargets(manual, included);
    expect(totals(built)).toEqual({ "5010": 2500, "2200": -2500 });
    expect(built.issues.map((issue) => issue.kind)).toEqual(["owner_manual_adjustment"]);
    expect(totals(ownerLedgerTargets(entry({ id: "le7", type: "REVERSAL", bucket: "AVAILABLE", amount_cents: -2500, reversal_of: "le6" }), { included: true, original: manual }))).toEqual({ "5010": -2500, "2200": 2500 });
  });

  it("keeps capital in owner funds, with suspense balancing the two legs", () => {
    expect(totals(ownerLedgerTargets(entry({ id: "c1", type: "CAPITAL_IN", bucket: "AVAILABLE", amount_cents: 5000000 }), included))).toEqual({ "1080": 5000000, "2300": -5000000 });
    const legs = [
      ownerLedgerTargets(entry({ id: "c2", type: "CAPITAL_ALLOCATED", bucket: "AVAILABLE", amount_cents: -4000000 }), included),
      ownerLedgerTargets(entry({ id: "c3", type: "CAPITAL_ALLOCATED", bucket: "INVESTED", amount_cents: 4000000 }), included),
    ];
    expect(totals({ items: legs.flatMap((built) => built.items), issues: [] })).toEqual({ "2300": 4000000, "2310": -4000000, "2900": 0 });
    const exit = [
      ownerLedgerTargets(entry({ id: "c4", type: "CAPITAL_RETURN", bucket: "INVESTED", amount_cents: -4000000 }), included),
      ownerLedgerTargets(entry({ id: "c5", type: "CAPITAL_RETURN", bucket: "AVAILABLE", amount_cents: 3800000 }), included),
    ];
    expect(totals({ items: exit.flatMap((built) => built.items), issues: [] })).toEqual({ "2310": 4000000, "2300": -3800000, "2900": -200000 });
    expect(legs.concat(exit).every((built) => built.issues[0]?.kind === "owner_capital")).toBe(true);
  });

  it("pays a withdrawal from earnings first and the rest from owner funds", () => {
    const paid = entry({ id: "w1", type: "WITHDRAWAL", bucket: "PAID_OUT", amount_cents: 150000 });
    expect(totals(ownerLedgerTargets(paid, { included: true, fromEarningsCents: 110084 }))).toEqual({ "2200": 110084, "2300": 39916, "1080": -150000 });
    expect(totals(ownerLedgerTargets(paid, { included: true, fromEarningsCents: 150000 }))).toEqual({ "2200": 150000, "1080": -150000 });
    const back = entry({ id: "x1", type: "REVERSAL", bucket: "PAID_OUT", amount_cents: -150000, reversal_of: "w1" });
    expect(totals(ownerLedgerTargets(back, { included: true, original: paid, fromEarningsCents: -110084 }))).toEqual({ "2200": -110084, "2300": -39916, "1080": 150000 });
  });

  it("does not book the reversal of a hold", () => {
    const hold = entry({ id: "h1", type: "WITHHELD", bucket: "AVAILABLE", amount_cents: -150000 });
    expect(ownerLedgerTargets(entry({ id: "h2", type: "REVERSAL", bucket: "AVAILABLE", amount_cents: 150000, reversal_of: "h1" }), { included: true, original: hold })).toEqual({ items: [], issues: [] });
  });

  it("skips holds, the house account and excluded owners", () => {
    expect(ownerLedgerTargets(entry({ type: "WITHHELD", bucket: "AVAILABLE", amount_cents: -150000 }), included).items).toEqual([]);
    expect(ownerLedgerTargets(entry({ type: "WITHHOLD_RELEASE", bucket: "AVAILABLE", amount_cents: 150000 }), included).items).toEqual([]);
    expect(ownerLedgerTargets(entry({ amount_cents: 1000, reservation_id: "res-1" }), { included: false }).items).toEqual([]);
  });

  it("every owner posting is balanced", () => {
    for (const built of [
      ownerLedgerTargets(entry({ id: "b1", amount_cents: 1234, reservation_id: "res-1" }), included),
      ownerLedgerTargets(entry({ id: "b2", type: "CAPITAL_ALLOCATED", bucket: "INVESTED", amount_cents: 777 }), included),
      ownerLedgerTargets(entry({ id: "b3", type: "WITHDRAWAL", bucket: "PAID_OUT", amount_cents: 999 }), { included: true, fromEarningsCents: 500 }),
    ]) {
      for (const posting of built.items) expect(posting.targets.reduce((sum, target) => sum + target.amount, 0)).toBe(0);
    }
  });
});

describe("settlements", () => {
  it("pays down the card or the shareholder from the company account", () => {
    const card = settlementTargets({ id: "s1", kind: "CARD_PAYMENT", paid_on: "2026-11-20", amount_cents: 45000, voided_at: null });
    expect(totals(card)).toEqual({ "2050": 45000, "1080": -45000 });
    expect(card.items[0]).toMatchObject({ source_type: "settlement", source_key: "settle:s1", economic_date: "2026-11-20" });
    const back = settlementTargets({ id: "s2", kind: "REIMBURSEMENT", paid_on: "2026-11-21", amount_cents: 3000, voided_at: null });
    expect(totals(back)).toEqual({ "2500": 3000, "1080": -3000 });
  });

  it("zeroes a voided settlement and ignores unknown kinds", () => {
    const voided = settlementTargets({ id: "s3", kind: "CARD_PAYMENT", paid_on: "2026-11-20", amount_cents: 45000, voided_at: "2026-11-22T00:00:00Z" });
    expect(voided.items[0].targets.every((target) => target.amount === 0)).toBe(true);
    expect(settlementTargets({ id: "s4", kind: "OTHER", paid_on: "2026-11-20", amount_cents: 100, voided_at: null }).items).toEqual([]);
  });
});
