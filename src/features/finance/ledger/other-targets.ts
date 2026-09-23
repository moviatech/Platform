import { laDate, lastDayOf, monthOf, nextMonth } from "./dates";
import { matchKey, type Mapping } from "./mapping";
import { item, type Built, type Issue, type Tags, type Target } from "./types";

const none: Built = { items: [], issues: [] };

export type OrderTag = { reservationId: string; included: boolean; vehicleId: string | null; locationId: string | null };
const orderTags = (order: OrderTag): Tags => ({ reservation_id: order.reservationId, vehicle_id: order.vehicleId, location_id: order.locationId });

export type OfflinePayment = { id: string; offline_method: string | null; status: string; amount_captured_cents: number; created_at: string; received_on?: string | null };
export type OfflineRefund = { id: string; offline_method: string | null; status: string; amount_cents: number; created_at: string };

const countedPayment = new Set(["SUCCEEDED", "PARTIALLY_REFUNDED", "REFUNDED"]);

export function offlinePaymentTargets(payment: OfflinePayment, order: OrderTag): Built {
  if (!payment.offline_method) return none;
  const amount = countedPayment.has(payment.status) ? payment.amount_captured_cents : 0;
  const counter = order.included ? "1100" : "2910";
  return { items: [item({ sourceType: "payment", sourceId: payment.id, key: `offpay:${payment.id}`, date: payment.received_on ?? laDate(payment.created_at), inputs: { method: payment.offline_method, status: payment.status, amount }, targets: [{ account: "1070", amount }, { account: counter, amount: -amount, ...orderTags(order) }] })], issues: [] };
}

export function offlineRefundTargets(refund: OfflineRefund, order: OrderTag): Built {
  if (!refund.offline_method) return none;
  const amount = refund.status === "SUCCEEDED" ? refund.amount_cents : 0;
  const counter = order.included ? "1100" : "2910";
  return { items: [item({ sourceType: "refund", sourceId: refund.id, key: `offref:${refund.id}`, date: laDate(refund.created_at), inputs: { method: refund.offline_method, status: refund.status, amount }, targets: [{ account: counter, amount, ...orderTags(order) }, { account: "1070", amount: -amount }] })], issues: [] };
}

export type ExpenseRow = {
  id: string;
  spent_on: string;
  category: string;
  amount_cents: number;
  vehicle_id: string | null;
  voided_at: string | null;
  location_id?: string | null;
  service_from?: string | null;
  service_to?: string | null;
  capital?: boolean | null;
  paid_from?: string | null;
};

export const PREPAID_ACCOUNT = "1200";
export const CAPITAL_ACCOUNT = "1500";
export const paidFromAccounts: Record<string, string> = { COMPANY_ACCOUNT: "1080", COMPANY_CARD: "2050", PERSONAL: "2500" };

const dayIndex = (date: string) => Math.round(Date.parse(`${date}T00:00:00Z`) / 86400000);

export function amortization(from: string, to: string, amount: number) {
  const total = dayIndex(to) - dayIndex(from) + 1;
  const months: Array<{ month: string; first: string; days: number }> = [];
  for (let month = monthOf(from); month <= monthOf(to); month = nextMonth(month)) {
    const first = month === monthOf(from) ? from : `${month}-01`;
    const last = month === monthOf(to) ? to : lastDayOf(month);
    months.push({ month, first, days: dayIndex(last) - dayIndex(first) + 1 });
  }
  const exact = months.map((entry) => (amount * entry.days) / total);
  const shares = exact.map((value) => Math.floor(value));
  let left = amount - shares.reduce((sum, value) => sum + value, 0);
  const order = exact.map((value, index) => ({ index, fraction: value - shares[index] })).sort((a, b) => b.fraction - a.fraction || a.index - b.index);
  for (const { index } of order) {
    if (left <= 0) break;
    shares[index] += 1;
    left -= 1;
  }
  return months.map((entry, index) => ({ month: entry.month, first: entry.first, amount: shares[index] }));
}

export function expenseTargets(expense: ExpenseRow, mappings: Mapping[], today: string): Built {
  const amount = expense.voided_at ? 0 : expense.amount_cents;
  const mapping = matchKey(mappings, expense.category);
  const account = mapping?.account ?? "2900";
  const capital = expense.capital === true;
  const period = !capital && expense.service_from && expense.service_to ? { from: expense.service_from, to: expense.service_to } : null;
  const issues: Issue[] = capital || mapping?.account || amount === 0 ? [] : [{ kind: "unmapped_expense", dedupeKey: `unmapped_expense:${expense.id}`, detail: { category: expense.category, amountCents: expense.amount_cents } }];
  const paidFrom = expense.paid_from ?? "COMPANY_ACCOUNT";
  const credit = paidFromAccounts[paidFrom] ?? "1080";
  const tags: Tags = { expense_id: expense.id, vehicle_id: expense.vehicle_id, ...(expense.location_id ? { location_id: expense.location_id } : {}) };
  const debit = capital ? CAPITAL_ACCOUNT : period ? PREPAID_ACCOUNT : account;
  const debitTags: Tags = period ? { expense_id: expense.id } : tags;
  const inputs = { category: expense.category, amount: expense.amount_cents, voided: expense.voided_at !== null, paidFrom, capital, period };
  const items = [item({ sourceType: "expense", sourceId: expense.id, key: `expense:${expense.id}`, date: expense.spent_on, inputs, targets: [{ account: debit, amount, ...debitTags }, { account: credit, amount: -amount, expense_id: expense.id }] })];
  if (period) {
    for (const part of amortization(period.from, period.to, amount)) {
      if (part.first > today) continue;
      items.push(item({ sourceType: "expense", sourceId: expense.id, key: `expense:${expense.id}:amort:${part.month}`, date: part.first, inputs: { month: part.month, amount: part.amount, of: amount }, targets: [{ account, amount: part.amount, ...tags }, { account: PREPAID_ACCOUNT, amount: -part.amount, expense_id: expense.id }] }));
    }
  }
  return { items, issues };
}

export type SettlementRow = { id: string; kind: string; paid_on: string; amount_cents: number; voided_at: string | null };

export const settlementAccounts: Record<string, string> = { CARD_PAYMENT: "2050", REIMBURSEMENT: "2500" };

export function settlementTargets(row: SettlementRow): Built {
  const debit = settlementAccounts[row.kind];
  if (!debit) return none;
  const amount = row.voided_at ? 0 : row.amount_cents;
  return { items: [item({ sourceType: "settlement", sourceId: row.id, key: `settle:${row.id}`, date: row.paid_on, inputs: { kind: row.kind, amount: row.amount_cents, voided: row.voided_at !== null }, targets: [{ account: debit, amount }, { account: "1080", amount: -amount }] })], issues: [] };
}

export type ResolutionRow = { id: string; reservation_id: string; category: string; amount_cents: number; approved_by: string | null; voided_at: string | null; created_at: string };

export const APPROVAL_THRESHOLD_CENTS = 10000;

const resolutionAccounts: Record<string, [string, string]> = {
  INCOME_DAMAGE: ["1100", "4080"],
  INCOME_FEES: ["1100", "4050"],
  INCOME_OTHER: ["1100", "4090"],
  ALLOWANCE: ["4940", "1100"],
  BAD_DEBT: ["5050", "1100"],
  REFUND_PAYABLE: ["1100", "2920"],
};

export const resolutionApproved = (row: Pick<ResolutionRow, "amount_cents" | "approved_by">) => row.amount_cents <= APPROVAL_THRESHOLD_CENTS || row.approved_by !== null;

export function resolutionTargets(row: ResolutionRow, order: Omit<OrderTag, "included">): Built {
  const accounts = resolutionAccounts[row.category];
  if (!accounts) return none;
  const amount = row.voided_at || !resolutionApproved(row) ? 0 : row.amount_cents;
  const tags: Tags = { reservation_id: order.reservationId, vehicle_id: order.vehicleId, location_id: order.locationId };
  return { items: [item({ sourceType: "resolution", sourceId: row.id, key: `resolution:${row.id}`, date: laDate(row.created_at), inputs: { category: row.category, amount: row.amount_cents, approved: row.approved_by !== null, voided: row.voided_at !== null }, targets: [{ account: accounts[0], amount, ...tags }, { account: accounts[1], amount: -amount, ...tags }] })], issues: [] };
}

export type OwnerEntry = {
  id: string;
  investor_id: string;
  type: string;
  bucket: string;
  amount_cents: number;
  reservation_id: string | null;
  vehicle_id: string | null;
  statement_id: string | null;
  reversal_of: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

export type OwnerEntryContext = { included: boolean; original?: OwnerEntry | null; statementMonth?: string | null; fromEarningsCents?: number };

export type OwnerShape = "share" | "mileage" | "manual" | "capital_in" | "capital" | "withdrawal" | "skip";

export function ownerEntryShape(entry: OwnerEntry, original: OwnerEntry | null | undefined): OwnerShape {
  if (entry.type === "WITHHELD" || entry.type === "WITHHOLD_RELEASE") return "skip";
  if (entry.type === "RENTAL_SHARE") return "share";
  if (entry.type === "MILEAGE_FEE") return "mileage";
  if (entry.type === "CAPITAL_IN") return "capital_in";
  if (entry.type === "CAPITAL_ALLOCATED" || entry.type === "CAPITAL_RETURN") return "capital";
  if (entry.type === "WITHDRAWAL") return "withdrawal";
  if (entry.type === "REVERSAL" && original) return ownerEntryShape(original, null);
  if (entry.reservation_id) return "share";
  if (entry.statement_id) return "mileage";
  return "manual";
}

export function ownerLedgerTargets(entry: OwnerEntry, context: OwnerEntryContext): Built {
  if (!context.included) return none;
  const shape = ownerEntryShape(entry, context.original);
  if (shape === "skip" || entry.amount_cents === 0) return none;
  const amount = entry.amount_cents;
  const tags: Tags = { investor_id: entry.investor_id, reservation_id: entry.reservation_id, vehicle_id: entry.vehicle_id };
  const owner: Tags = { investor_id: entry.investor_id };
  const issues: Issue[] = [];
  let date = laDate(entry.created_at);
  let targets: Target[];
  switch (shape) {
    case "share":
      targets = [{ account: "2210", amount, ...tags }, { account: "2200", amount: -amount, ...tags }];
      break;
    case "mileage": {
      const month = context.statementMonth ?? (typeof entry.metadata?.month === "string" ? entry.metadata.month.slice(0, 7) : null);
      if (month) date = lastDayOf(month);
      targets = [{ account: "5020", amount, ...tags }, { account: "2200", amount: -amount, ...tags }];
      break;
    }
    case "manual":
      targets = [{ account: "5010", amount, ...tags }, { account: "2200", amount: -amount, ...tags }];
      issues.push({ kind: "owner_manual_adjustment", dedupeKey: `owner_manual_adjustment:${entry.id}`, investorId: entry.investor_id, detail: { entry: entry.id, amountCents: amount } });
      break;
    case "capital_in":
      targets = [{ account: "1080", amount }, { account: "2300", amount: -amount, ...owner }];
      issues.push({ kind: "owner_capital", dedupeKey: `owner_capital:${entry.id}`, investorId: entry.investor_id, detail: { entry: entry.id, type: entry.type, amountCents: amount } });
      break;
    case "capital": {
      const account = entry.bucket === "INVESTED" ? "2310" : "2300";
      targets = [{ account, amount: -amount, ...owner, vehicle_id: entry.vehicle_id }, { account: "2900", amount, ...owner }];
      issues.push({ kind: "owner_capital", dedupeKey: `owner_capital:${entry.id}`, investorId: entry.investor_id, detail: { entry: entry.id, type: entry.type, bucket: entry.bucket, amountCents: amount } });
      break;
    }
    case "withdrawal": {
      const fromEarnings = context.fromEarningsCents ?? amount;
      targets = [{ account: "2200", amount: fromEarnings, ...owner }, { account: "2300", amount: amount - fromEarnings, ...owner }, { account: "1080", amount: -amount }];
      break;
    }
  }
  return { items: [item({ sourceType: "investor_ledger", sourceId: entry.id, key: `ownerledger:${entry.id}`, date, inputs: { type: entry.type, bucket: entry.bucket, amount, reversalOf: entry.reversal_of }, targets })], issues };
}
