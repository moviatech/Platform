import "server-only";
import { cache } from "react";
import type { InvestorStatus } from "@/lib/auth/investor";
import { createAdminClient } from "@/lib/supabase/admin";
import type { InvestorBalances } from "./ledger";

export type Stake = { id: string; company_id: string; member_id: string; amount_cents: number; effective_on: string; note: string | null; created_at: string; voided_at: string | null };

export type MemberPosition = InvestorBalances & { stakeCents: number; ratio: number };

export type MemberRow = MemberPosition & { id: string; investor_number: string; legal_name: string; email: string | null; status: InvestorStatus };

export type CompanyOption = { id: string; investor_number: string; legal_name: string };

type BalanceRow = { member_id: string; available_cents: number; pending_cents: number; invested_cents: number; withdrawn_cents: number; held_cents: number; stake_cents: number; ratio: number | string };

const balanceColumns = "member_id, available_cents, pending_cents, invested_cents, withdrawn_cents, held_cents, stake_cents, ratio";
const stakeColumns = "id, company_id, member_id, amount_cents, effective_on, note, created_at, voided_at";

const position = (row: BalanceRow | null | undefined, activeAllocations = 0): MemberPosition => ({
  availableCents: row?.available_cents ?? 0,
  pendingCents: row?.pending_cents ?? 0,
  heldCents: row?.held_cents ?? 0,
  investedCents: row?.invested_cents ?? 0,
  withdrawnCents: row?.withdrawn_cents ?? 0,
  activeAllocations,
  stakeCents: Number(row?.stake_cents ?? 0),
  ratio: Number(row?.ratio ?? 0),
});

export const loadMemberPosition = cache(async (memberId: string, companyId: string): Promise<MemberPosition> => {
  const admin = createAdminClient();
  const [{ data }, { count }] = await Promise.all([
    admin.from("investor_member_balances").select(balanceColumns).eq("member_id", memberId).maybeSingle(),
    admin.from("investor_allocations").select("id", { count: "exact", head: true }).eq("investor_id", companyId).in("status", ["ACTIVE", "EXITING"]),
  ]);
  return position(data as BalanceRow | null, count ?? 0);
});

export async function listStakes(filter: { companyId?: string; memberId?: string }): Promise<Stake[]> {
  let query = createAdminClient().from("investor_stakes").select(stakeColumns).order("effective_on", { ascending: false }).order("created_at", { ascending: false }).limit(500);
  if (filter.companyId) query = query.eq("company_id", filter.companyId);
  if (filter.memberId) query = query.eq("member_id", filter.memberId);
  const { data } = await query;
  return (data ?? []) as Stake[];
}

export async function listMembers(companyId: string): Promise<MemberRow[]> {
  const admin = createAdminClient();
  const [{ data: rows }, { data: balances }] = await Promise.all([
    admin.from("investors").select("id, investor_number, legal_name, email, status").eq("company_id", companyId).order("created_at"),
    admin.from("investor_member_balances").select(balanceColumns).eq("company_id", companyId),
  ]);
  const byMember = new Map(((balances ?? []) as BalanceRow[]).map((row) => [row.member_id, row]));
  return ((rows ?? []) as Array<{ id: string; investor_number: string; legal_name: string; email: string | null; status: InvestorStatus }>).map((row) => ({ ...row, ...position(byMember.get(row.id)) }));
}

export async function memberPositions(memberIds: string[]): Promise<Map<string, MemberPosition>> {
  if (!memberIds.length) return new Map();
  const { data } = await createAdminClient().from("investor_member_balances").select(balanceColumns).in("member_id", memberIds);
  return new Map(((data ?? []) as BalanceRow[]).map((row) => [row.member_id, position(row)]));
}

export async function investorNames(ids: Array<string | null | undefined>): Promise<Map<string, CompanyOption>> {
  const unique = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  if (!unique.length) return new Map();
  const { data } = await createAdminClient().from("investors").select("id, investor_number, legal_name").in("id", unique);
  return new Map(((data ?? []) as CompanyOption[]).map((row) => [row.id, row]));
}

export async function listCompanies(): Promise<CompanyOption[]> {
  const { data } = await createAdminClient().from("investors").select("id, investor_number, legal_name").eq("kind", "COMPANY").eq("compensation", "REVENUE_SHARE").in("status", ["ACTIVE", "SUSPENDED", "PENDING"]).order("legal_name");
  return (data ?? []) as CompanyOption[];
}

export async function listAttachable(): Promise<CompanyOption[]> {
  const admin = createAdminClient();
  const { data } = await admin.from("investors").select("id, investor_number, legal_name").eq("kind", "INDIVIDUAL").is("company_id", null).eq("house", false).in("status", ["PENDING", "ACTIVE", "SUSPENDED"]).order("legal_name").limit(500);
  const rows = (data ?? []) as CompanyOption[];
  if (!rows.length) return [];
  const ids = rows.map((row) => row.id);
  const used = new Set<string>();
  await Promise.all(
    ["investor_allocations", "investor_contributions", "investor_ledger_entries", "investor_bank_accounts", "investor_withdrawals"].map(async (table) => {
      const { data: owned } = await admin.from(table).select("investor_id").in("investor_id", ids).limit(1000);
      for (const row of (owned ?? []) as Array<{ investor_id: string }>) used.add(row.investor_id);
    }),
  );
  return rows.filter((row) => !used.has(row.id));
}

export const percent = (ratio: number) => `${(ratio * 100).toFixed(2)}%`;
