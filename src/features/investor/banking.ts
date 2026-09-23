import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

export type BankAccount = { id: string; investor_id: string; bank_name: string; account_type: "CHECKING" | "SAVINGS"; holder_name: string; last4: string; usable_after: string; removed_at: string | null; created_at: string };

export type Withdrawal = {
  id: string;
  investor_id: string;
  bank_account_id: string;
  amount_cents: number;
  status: "REQUESTED" | "APPROVED" | "PAID" | "DECLINED" | "CANCELLED";
  approval_id: string | null;
  reviewed_at: string | null;
  decision_note: string | null;
  paid_reference: string | null;
  paid_at: string | null;
  created_at: string;
  bank_account: { bank_name: string; last4: string; account_type: string } | null;
  investor?: { id: string; legal_name: string; investor_number: string } | null;
  reviewer?: { display_name: string } | null;
  approval?: { status: string } | null;
};

const accountColumns = "id, investor_id, bank_name, account_type, holder_name, last4, usable_after, removed_at, created_at";
const withdrawalColumns = "id, investor_id, bank_account_id, amount_cents, status, approval_id, reviewed_at, decision_note, paid_reference, paid_at, created_at, bank_account:investor_bank_accounts(bank_name, last4, account_type), investor:investors(id, legal_name, investor_number), reviewer:staff_members!investor_withdrawals_reviewed_by_fkey(display_name), approval:approvals!investor_withdrawals_approval_fkey(status)";

export async function listBankAccounts(investorId: string, includeRemoved = false): Promise<BankAccount[]> {
  let query = createAdminClient().from("investor_bank_accounts").select(accountColumns).eq("investor_id", investorId).order("created_at", { ascending: false });
  if (!includeRemoved) query = query.is("removed_at", null);
  const { data } = await query;
  return (data ?? []) as BankAccount[];
}

export async function getBankAccount(id: string, investorId?: string): Promise<(BankAccount & { encrypted_payload: string }) | null> {
  let query = createAdminClient().from("investor_bank_accounts").select(`${accountColumns}, encrypted_payload`).eq("id", id);
  if (investorId) query = query.eq("investor_id", investorId);
  const { data } = await query.maybeSingle();
  return (data as (BankAccount & { encrypted_payload: string }) | null) ?? null;
}

export async function listWithdrawals(investorId: string): Promise<Withdrawal[]> {
  const { data } = await createAdminClient().from("investor_withdrawals").select(withdrawalColumns).eq("investor_id", investorId).order("created_at", { ascending: false }).limit(100);
  return (data ?? []) as unknown as Withdrawal[];
}

export async function listOpenWithdrawals(): Promise<Withdrawal[]> {
  const { data } = await createAdminClient().from("investor_withdrawals").select(withdrawalColumns).in("status", ["REQUESTED", "APPROVED"]).order("created_at");
  return (data ?? []) as unknown as Withdrawal[];
}

export async function countOpenWithdrawals() {
  const { count } = await createAdminClient().from("investor_withdrawals").select("id", { count: "exact", head: true }).in("status", ["REQUESTED", "APPROVED"]);
  return count ?? 0;
}

export async function getWithdrawal(id: string): Promise<Withdrawal | null> {
  const { data } = await createAdminClient().from("investor_withdrawals").select(withdrawalColumns).eq("id", id).maybeSingle();
  return (data as unknown as Withdrawal | null) ?? null;
}
