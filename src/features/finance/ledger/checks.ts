import type { PostedRow } from "./assemble";
import { addDays, laDate } from "./dates";
import type { Issue } from "./types";

export type CheckResult = { name: string; ok: boolean; count: number };
export type Checked = { results: CheckResult[]; issues: Issue[] };

type TrialRow = { account: string; debit: number; credit: number };
type ClosedOrder = { id: string; number: string; status: string; actual_return_at: string | null; completed_at: string | null; cancelled_at: string | null; updated_at: string };
type OwnerBalance = { investor_id: string; account: string; balance: number };
type InvestorBalance = { investor_id: string; available_cents: number; pending_cents: number; invested_cents: number; held_cents: number };

const closedStatuses = new Set(["COMPLETED", "CANCELLED", "NO_SHOW", "EXPIRED"]);

const closedOn = (order: ClosedOrder) => order.completed_at ?? order.actual_return_at ?? order.cancelled_at ?? order.updated_at;

export function evaluateChecks(input: {
  today: string;
  trial: TrialRow[];
  orderBalances: Array<{ reservation_id: string; balance: number }>;
  orders: ClosedOrder[];
  posted: PostedRow[];
  ownerBalances: OwnerBalance[];
  investorBalances: InvestorBalance[];
  includedInvestors: Set<string>;
  spreadByOrder: Map<string, number>;
  unsyncedPayments: Array<{ id: string; reservation_id: string }>;
  exposed: Array<{ object_name: string; grantee: string; privilege: string }>;
  stripeBalance?: number | null;
  snapshotCounts?: Array<{ source_table: string; snapshots: number; table_rows: number }>;
}): Checked {
  const results: CheckResult[] = [];
  const issues: Issue[] = [];
  const add = (name: string, failures: Issue[]) => {
    results.push({ name, ok: failures.length === 0, count: failures.length });
    issues.push(...failures);
  };

  const debit = input.trial.reduce((sum, row) => sum + Number(row.debit), 0);
  const credit = input.trial.reduce((sum, row) => sum + Number(row.credit), 0);
  add("trial_balance", debit === credit ? [] : [{ kind: "check_trial_balance", dedupeKey: `check_trial_balance:${input.today}`, detail: { debit, credit } }]);

  const orderById = new Map(input.orders.map((order) => [order.id, order]));
  const weekAgo = addDays(input.today, -7);
  add(
    "closed_orders_settled",
    input.orderBalances
      .filter((row) => Number(row.balance) !== 0)
      .flatMap((row) => {
        const order = orderById.get(row.reservation_id);
        if (!order || !closedStatuses.has(order.status) || laDate(closedOn(order)) > weekAgo) return [];
        return [{ kind: "check_open_balance", dedupeKey: `check_open_balance:${order.id}`, reservationId: order.id, detail: { number: order.number, status: order.status, balanceCents: Number(row.balance) } }];
      }),
  );

  const recognized = new Map<string, number>();
  const accrued = new Map<string, number>();
  for (const row of input.posted) {
    if (row.source_key.includes(":rec:") && row.account !== "1100" && row.reservation_id) recognized.set(row.reservation_id, (recognized.get(row.reservation_id) ?? 0) - Number(row.balance));
    if (row.account === "2210" && row.reservation_id) accrued.set(row.reservation_id, (accrued.get(row.reservation_id) ?? 0) + Number(row.balance));
  }
  add(
    "completed_recognition",
    input.orders
      .filter((order) => order.status === "COMPLETED" && input.spreadByOrder.has(order.id) && (recognized.get(order.id) ?? 0) !== input.spreadByOrder.get(order.id))
      .map((order) => ({ kind: "check_recognition", dedupeKey: `check_recognition:${order.id}`, reservationId: order.id, detail: { number: order.number, recognizedCents: recognized.get(order.id) ?? 0, linesCents: input.spreadByOrder.get(order.id) } })),
  );

  const threeDaysAgo = addDays(input.today, -3);
  add(
    "accrual_cleared",
    input.orders
      .filter((order) => order.status === "COMPLETED" && laDate(closedOn(order)) <= threeDaysAgo && (accrued.get(order.id) ?? 0) !== 0)
      .map((order) => ({ kind: "check_accrual_left", dedupeKey: `check_accrual_left:${order.id}`, reservationId: order.id, detail: { number: order.number, accruedCents: accrued.get(order.id) } })),
  );

  const suspense = input.trial.filter((row) => row.account === "2900").reduce((sum, row) => sum + Number(row.debit) - Number(row.credit), 0);
  add("suspense_empty", suspense === 0 ? [] : [{ kind: "check_suspense", dedupeKey: `check_suspense:${input.today}`, detail: { balanceCents: suspense } }]);

  const books = new Map<string, number>();
  for (const row of input.ownerBalances) {
    if (row.account === "2210") continue;
    books.set(row.investor_id, (books.get(row.investor_id) ?? 0) + Number(row.balance));
  }
  add(
    "owner_balances",
    input.investorBalances
      .filter((row) => input.includedInvestors.has(row.investor_id))
      .flatMap((row) => {
        const ledger = row.available_cents + row.pending_cents + row.invested_cents + row.held_cents;
        const booked = books.get(row.investor_id) ?? 0;
        return ledger === booked ? [] : [{ kind: "check_owner_balance", dedupeKey: `check_owner_balance:${row.investor_id}:${input.today}`, investorId: row.investor_id, detail: { ledgerCents: ledger, bookedCents: booked } }];
      }),
  );

  add(
    "card_payments_synced",
    input.unsyncedPayments.map((payment) => ({ kind: "check_unsynced_payment", dedupeKey: `check_unsynced_payment:${payment.id}`, reservationId: payment.reservation_id, detail: { payment: payment.id } })),
  );

  add("no_public_grants", input.exposed.length === 0 ? [] : [{ kind: "check_public_grants", dedupeKey: `check_public_grants:${input.today}`, detail: { grants: input.exposed.slice(0, 20) } }]);

  if (input.snapshotCounts) {
    add(
      "snapshots_complete",
      input.snapshotCounts
        .filter((row) => Number(row.snapshots) !== Number(row.table_rows))
        .map((row) => ({ kind: "check_snapshots", dedupeKey: `check_snapshots:${row.source_table}:${input.today}`, detail: { table: row.source_table, snapshots: Number(row.snapshots), rows: Number(row.table_rows) } })),
    );
  }

  if (typeof input.stripeBalance === "number") {
    const booked = input.trial.filter((row) => row.account === "1050").reduce((sum, row) => sum + Number(row.debit) - Number(row.credit), 0);
    add("stripe_balance", booked === input.stripeBalance ? [] : [{ kind: "check_stripe_balance", dedupeKey: `check_stripe_balance:${input.today}`, detail: { bookedCents: booked, stripeCents: input.stripeBalance } }]);
  }

  return { results, issues };
}
