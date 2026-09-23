import { describe, expect, it } from "vitest";
import type { PostedRow } from "./assemble";
import { evaluateChecks } from "./checks";

const row = (overrides: Partial<PostedRow>): PostedRow => ({ source_key: "k", source_id: "s", account: "1100", reservation_id: null, vehicle_id: null, location_id: null, investor_id: null, expense_id: null, stripe_id: null, revenue_class: null, balance: 0, ...overrides });
const order = { id: "r1", number: "MV-CRFBZ6", status: "COMPLETED", actual_return_at: "2027-01-16T14:00:00Z", completed_at: "2027-01-16T15:00:00Z", cancelled_at: null, updated_at: "2027-01-16T15:00:00Z" };
const base = {
  today: "2027-01-30",
  trial: [
    { account: "1100", debit: 197900, credit: 197900 },
    { account: "4010", debit: 0, credit: 325080 },
    { account: "4930", debit: 211180, credit: 0 },
    { account: "4020", debit: 0, credit: 84000 },
    { account: "1050", debit: 197900, credit: 0 },
  ],
  orderBalances: [{ reservation_id: "r1", balance: 0 }],
  orders: [order],
  posted: [
    row({ source_key: "order:r1:rec:2026-12", account: "4010", reservation_id: "r1", balance: -144260 }),
    row({ source_key: "order:r1:rec:2027-01", account: "4010", reservation_id: "r1", balance: -180820 }),
    row({ source_key: "order:r1:rec:2026-12", account: "4020", reservation_id: "r1", balance: -84000 }),
    row({ source_key: "order:r1:rec:2026-12", account: "4930", reservation_id: "r1", balance: 211180 }),
    row({ source_key: "order:r1:rec:2026-12", account: "1100", reservation_id: "r1", balance: 197900 }),
    row({ source_key: "order:r1:own:2026-12", account: "2210", reservation_id: "r1", balance: -110084 }),
    row({ source_key: "ownerledger:e1", account: "2210", reservation_id: "r1", balance: 110084 }),
  ],
  ownerBalances: [{ investor_id: "inv", account: "2200", balance: 110084 }, { investor_id: "inv", account: "2210", balance: 0 }],
  investorBalances: [{ investor_id: "inv", available_cents: 0, pending_cents: 110084, invested_cents: 0, held_cents: 0 }],
  includedInvestors: new Set(["inv"]),
  spreadByOrder: new Map([["r1", 197900]]),
  unsyncedPayments: [],
  exposed: [],
};

describe("evaluateChecks", () => {
  it("passes a settled book", () => {
    const checked = evaluateChecks(base);
    expect(checked.results.every((result) => result.ok)).toBe(true);
    expect(checked.results.map((result) => result.name)).toEqual(["trial_balance", "closed_orders_settled", "completed_recognition", "accrual_cleared", "suspense_empty", "owner_balances", "card_payments_synced", "no_public_grants"]);
    expect(checked.issues).toEqual([]);
  });

  it("flags every kind of mismatch", () => {
    const checked = evaluateChecks({
      ...base,
      trial: [...base.trial, { account: "2900", debit: 0, credit: 500 }],
      orderBalances: [{ reservation_id: "r1", balance: 1200 }],
      posted: base.posted.filter((entry) => entry.source_key !== "ownerledger:e1"),
      ownerBalances: [{ investor_id: "inv", account: "2200", balance: 100000 }],
      spreadByOrder: new Map([["r1", 197800]]),
      unsyncedPayments: [{ id: "p1", reservation_id: "r1" }],
      exposed: [{ object_name: "fin_settings", grantee: "anon", privilege: "SELECT" }],
    });
    expect(Object.fromEntries(checked.results.map((result) => [result.name, result.ok]))).toEqual({
      trial_balance: false,
      closed_orders_settled: false,
      completed_recognition: false,
      accrual_cleared: false,
      suspense_empty: false,
      owner_balances: false,
      card_payments_synced: false,
      no_public_grants: false,
    });
    expect(checked.issues.map((issue) => issue.kind).sort()).toEqual(["check_accrual_left", "check_open_balance", "check_owner_balance", "check_public_grants", "check_recognition", "check_suspense", "check_trial_balance", "check_unsynced_payment"]);
  });

  it("compares the Stripe balance account with Stripe only when a balance is given", () => {
    const trial = [...base.trial.filter((row) => row.account !== "1050"), { account: "1050", debit: 134, credit: 200 }, { account: "5030", debit: 66, credit: 0 }];
    expect(evaluateChecks({ ...base, trial }).results.some((result) => result.name === "stripe_balance")).toBe(false);
    expect(evaluateChecks({ ...base, trial, stripeBalance: -66 }).results.find((result) => result.name === "stripe_balance")?.ok).toBe(true);
    const off = evaluateChecks({ ...base, trial, stripeBalance: 0 });
    expect(off.results.find((result) => result.name === "stripe_balance")?.ok).toBe(false);
    expect(off.issues.find((issue) => issue.kind === "check_stripe_balance")?.detail).toEqual({ bookedCents: -66, stripeCents: 0 });
  });

  it("compares snapshot counts with table rows", () => {
    const fine = evaluateChecks({ ...base, snapshotCounts: [{ source_table: "payments", snapshots: 3, table_rows: 3 }] });
    expect(fine.results.find((result) => result.name === "snapshots_complete")?.ok).toBe(true);
    const off = evaluateChecks({ ...base, snapshotCounts: [{ source_table: "payments", snapshots: 2, table_rows: 3 }, { source_table: "refunds", snapshots: 0, table_rows: 0 }] });
    expect(off.results.find((result) => result.name === "snapshots_complete")).toEqual({ name: "snapshots_complete", ok: false, count: 1 });
    expect(off.issues.find((issue) => issue.kind === "check_snapshots")?.detail).toEqual({ table: "payments", snapshots: 2, rows: 3 });
    expect(evaluateChecks(base).results.some((result) => result.name === "snapshots_complete")).toBe(false);
  });

  it("gives recently closed orders time before flagging them", () => {
    const fresh = evaluateChecks({ ...base, today: "2027-01-18", orderBalances: [{ reservation_id: "r1", balance: 1200 }], posted: base.posted.filter((entry) => entry.source_key !== "ownerledger:e1") });
    expect(fresh.results.find((result) => result.name === "closed_orders_settled")?.ok).toBe(true);
    expect(fresh.results.find((result) => result.name === "accrual_cleared")?.ok).toBe(true);
  });
});
