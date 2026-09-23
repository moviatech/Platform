import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { readAll } from "./paging";
import { monthRange, type ExpenseCategory, type ExpenseMethod, type ExpensePaidFrom } from "./report";

export type Expense = {
  id: string;
  spent_on: string;
  category: ExpenseCategory;
  amount_cents: number;
  vendor: string | null;
  vehicle_id: string | null;
  location_id: string | null;
  method: ExpenseMethod;
  paid_from: ExpensePaidFrom;
  service_from: string | null;
  service_to: string | null;
  capital: boolean;
  reference: string | null;
  note: string | null;
  created_at: string;
  voided_at: string | null;
  void_reason: string | null;
  recurring_id: string | null;
  recurring: { name: string } | null;
  service_log_id: string | null;
  service_log: { performed_on: string } | null;
  vehicle: { fleet_number: string } | null;
  location: { name: string; name_zh: string | null } | null;
  author: { display_name: string } | null;
  receipts: Array<{ id: string }>;
};

const columns =
  "id, spent_on, category, amount_cents, vendor, vehicle_id, location_id, method, paid_from, service_from, service_to, capital, reference, note, created_at, voided_at, void_reason, recurring_id, recurring:fin_recurring(name), service_log_id, service_log:vehicle_service_logs(performed_on), vehicle:vehicles(fleet_number), location:locations(name, name_zh), author:staff_members!expenses_created_by_fkey(display_name), receipts:expense_receipts(id)";

export async function listExpenses(month: string): Promise<Expense[]> {
  const { from, to } = monthRange(month);
  const supabase = createAdminClient();
  return readAll<Expense>((start, stop) => supabase.from("expenses").select(columns).gte("spent_on", from).lte("spent_on", to).order("spent_on", { ascending: false }).order("created_at", { ascending: false }).order("id").range(start, stop), { strict: true });
}

export async function listExpensesBetween(from: string, to: string): Promise<Expense[]> {
  const supabase = createAdminClient();
  return readAll<Expense>((start, stop) => supabase.from("expenses").select(columns).gte("spent_on", from).lte("spent_on", to).order("spent_on").order("created_at").order("id").range(start, stop), { strict: true });
}

export const receiptBucket = "expense-receipts";

export type Receipt = { id: string; expense_id: string; storage_path: string; content_type: string };

export async function getReceipt(id: string): Promise<Receipt | null> {
  const { data } = await createAdminClient().from("expense_receipts").select("id, expense_id, storage_path, content_type").eq("id", id).maybeSingle();
  return (data as Receipt | null) ?? null;
}

export async function downloadReceipt(path: string) {
  const { data, error } = await createAdminClient().storage.from(receiptBucket).download(path);
  return error || !data ? null : data;
}

export type VehiclePick = { id: string; fleet_number: string };

export async function listVehiclePicks(): Promise<VehiclePick[]> {
  const { data } = await createAdminClient().from("vehicles").select("id, fleet_number").order("fleet_number");
  return (data ?? []) as VehiclePick[];
}

export type LocationPick = { id: string; name: string; name_zh: string | null; active: boolean };

export async function listLocationPicks(): Promise<LocationPick[]> {
  const { data } = await createAdminClient().from("locations").select("id, name, name_zh, active").order("active", { ascending: false }).order("name");
  return (data ?? []) as LocationPick[];
}
