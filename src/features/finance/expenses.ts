import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { monthRange, type ExpenseCategory, type ExpenseMethod } from "./report";

export type Expense = {
  id: string;
  spent_on: string;
  category: ExpenseCategory;
  amount_cents: number;
  vendor: string | null;
  vehicle_id: string | null;
  method: ExpenseMethod;
  reference: string | null;
  note: string | null;
  created_at: string;
  voided_at: string | null;
  void_reason: string | null;
  vehicle: { fleet_number: string } | null;
  author: { display_name: string } | null;
  receipts: Array<{ id: string }>;
};

const columns = "id, spent_on, category, amount_cents, vendor, vehicle_id, method, reference, note, created_at, voided_at, void_reason, vehicle:vehicles(fleet_number), author:staff_members!expenses_created_by_fkey(display_name), receipts:expense_receipts(id)";

export async function listExpenses(month: string): Promise<Expense[]> {
  const { from, to } = monthRange(month);
  const { data } = await createAdminClient().from("expenses").select(columns).gte("spent_on", from).lte("spent_on", to).order("spent_on", { ascending: false }).order("created_at", { ascending: false }).limit(1000);
  return (data ?? []) as unknown as Expense[];
}

export async function listExpensesBetween(from: string, to: string): Promise<Expense[]> {
  const { data } = await createAdminClient().from("expenses").select(columns).gte("spent_on", from).lte("spent_on", to).order("spent_on").order("created_at").limit(5000);
  return (data ?? []) as unknown as Expense[];
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
