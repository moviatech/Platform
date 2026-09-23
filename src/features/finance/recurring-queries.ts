import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { readAll } from "./paging";
import { pendingDates, resolvedKey, type SettlementKind } from "./recurring";
import type { ExpenseCategory, ExpenseMethod, ExpensePaidFrom } from "./report";

export type RecurringRow = {
  id: string;
  name: string;
  category: ExpenseCategory;
  amount_cents: number;
  every_months: number;
  starts_on: string;
  ends_on: string | null;
  vendor: string | null;
  vehicle_id: string | null;
  location_id: string | null;
  method: ExpenseMethod;
  paid_from: ExpensePaidFrom;
  spread: boolean;
  note: string | null;
  vehicle: { fleet_number: string } | null;
  location: { name: string; name_zh: string | null } | null;
};

const columns = "id, name, category, amount_cents, every_months, starts_on, ends_on, vendor, vehicle_id, location_id, method, paid_from, spread, note, vehicle:vehicles(fleet_number), location:locations(name, name_zh)";

export type Pending = { row: RecurringRow; dueOn: string };

export async function loadRecurring(today: string) {
  const supabase = createAdminClient();
  const [templates, linked, skips] = await Promise.all([
    readAll<RecurringRow>((from, to) => supabase.from("fin_recurring").select(columns).order("created_at").order("id").range(from, to), { strict: true }),
    readAll<{ recurring_id: string; recurring_on: string; voided_at: string | null }>((from, to) => supabase.from("expenses").select("recurring_id, recurring_on, voided_at").not("recurring_id", "is", null).order("id").range(from, to), { strict: true }),
    readAll<{ recurring_id: string; due_on: string }>((from, to) => supabase.from("fin_recurring_skips").select("recurring_id, due_on").order("recurring_id").order("due_on").range(from, to), { strict: true }),
  ]);
  const resolved = new Set([...linked.filter((row) => !row.voided_at).map((row) => resolvedKey(row.recurring_id, row.recurring_on)), ...skips.map((row) => resolvedKey(row.recurring_id, row.due_on))]);
  const used = new Set([...linked.map((row) => row.recurring_id), ...skips.map((row) => row.recurring_id)]);
  const pending: Pending[] = templates.flatMap((row) => pendingDates(row, today, resolved).map((dueOn) => ({ row, dueOn }))).sort((a, b) => a.dueOn.localeCompare(b.dueOn) || a.row.name.localeCompare(b.row.name));
  return { templates, pending, used };
}

export type Settlement = {
  id: string;
  kind: SettlementKind;
  paid_on: string;
  amount_cents: number;
  reference: string | null;
  note: string | null;
  created_at: string;
  voided_at: string | null;
  void_reason: string | null;
  author: { display_name: string } | null;
};

const settlementColumns = "id, kind, paid_on, amount_cents, reference, note, created_at, voided_at, void_reason, author:staff_members!fin_settlements_created_by_fkey(display_name)";

export async function listSettlements(from?: string, to?: string): Promise<Settlement[]> {
  const supabase = createAdminClient();
  return readAll<Settlement>((start, stop) => {
    let query = supabase.from("fin_settlements").select(settlementColumns);
    if (from) query = query.gte("paid_on", from);
    if (to) query = query.lte("paid_on", to);
    return query.order("paid_on", { ascending: false }).order("created_at", { ascending: false }).order("id").range(start, stop);
  }, { strict: true });
}

export async function loadOwedSources() {
  const supabase = createAdminClient();
  return readAll<{ paid_from: string; amount_cents: number; voided_at: string | null }>((from, to) => supabase.from("expenses").select("paid_from, amount_cents, voided_at").in("paid_from", ["COMPANY_CARD", "PERSONAL"]).order("id").range(from, to), { maxRows: 100000, strict: true });
}
