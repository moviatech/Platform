import { shiftMonths } from "./board/range";
import { addDays } from "./ledger/dates";

export const recurringIntervals = [1, 3, 6, 12] as const;

export type RecurringSchedule = { id: string; starts_on: string; ends_on: string | null; every_months: number };

const LIMIT = 1200;

export const occurrence = (row: Pick<RecurringSchedule, "starts_on" | "every_months">, index: number) => shiftMonths(row.starts_on, index * row.every_months);

export function occurrenceIndex(row: Pick<RecurringSchedule, "starts_on" | "every_months">, date: string) {
  for (let index = 0; index < LIMIT; index += 1) {
    const value = occurrence(row, index);
    if (value === date) return index;
    if (value > date) return -1;
  }
  return -1;
}

export function dueDates(row: RecurringSchedule, through: string) {
  const dates: string[] = [];
  for (let index = 0; index < LIMIT; index += 1) {
    const date = occurrence(row, index);
    if (date > through || (row.ends_on !== null && date > row.ends_on)) break;
    dates.push(date);
  }
  return dates;
}

export function nextDue(row: RecurringSchedule, after: string) {
  for (let index = 0; index < LIMIT; index += 1) {
    const date = occurrence(row, index);
    if (row.ends_on !== null && date > row.ends_on) return null;
    if (date > after) return date;
  }
  return null;
}

export const isDue = (row: RecurringSchedule, date: string, today: string) => date <= today && (row.ends_on === null || date <= row.ends_on) && occurrenceIndex(row, date) >= 0;

export function coverage(row: Pick<RecurringSchedule, "starts_on" | "every_months">, date: string) {
  const index = occurrenceIndex(row, date);
  return index < 0 ? null : { from: date, to: addDays(occurrence(row, index + 1), -1) };
}

export const resolvedKey = (id: string, date: string) => `${id}:${date}`;

export const pendingDates = (row: RecurringSchedule, today: string, resolved: Set<string>) => dueDates(row, today).filter((date) => !resolved.has(resolvedKey(row.id, date)));

export function recurringStartError(startsOn: string, endsOn: string | undefined, today: string): "start" | "end" | null {
  if (startsOn < addDays(today, -366) || startsOn > addDays(today, 366)) return "start";
  if (endsOn !== undefined && endsOn < startsOn) return "end";
  return null;
}

export type SettlementKind = "CARD_PAYMENT" | "REIMBURSEMENT";
export const settlementKinds = ["CARD_PAYMENT", "REIMBURSEMENT"] as const;
export const settlementSource: Record<SettlementKind, "COMPANY_CARD" | "PERSONAL"> = { CARD_PAYMENT: "COMPANY_CARD", REIMBURSEMENT: "PERSONAL" };

export function owedBalances(expenses: Array<{ paid_from: string; amount_cents: number; voided_at: string | null }>, settlements: Array<{ kind: string; amount_cents: number; voided_at: string | null }>) {
  const owed: Record<SettlementKind, number> = { CARD_PAYMENT: 0, REIMBURSEMENT: 0 };
  for (const kind of settlementKinds) {
    const charged = expenses.filter((row) => !row.voided_at && row.paid_from === settlementSource[kind]).reduce((sum, row) => sum + row.amount_cents, 0);
    const paid = settlements.filter((row) => !row.voided_at && row.kind === kind).reduce((sum, row) => sum + row.amount_cents, 0);
    owed[kind] = charged - paid;
  }
  return owed;
}
