import "server-only";
import { investorColumns, investorStatuses, type InvestorRow, type InvestorStatus } from "@/lib/auth/investor";
import { createAdminClient } from "@/lib/supabase/admin";

export type InvestorListRow = InvestorRow & { reviewed_at: string | null };

export type InvestorDetail = InvestorRow & {
  notes: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_note: string | null;
  created_by: string | null;
  updated_at: string;
  reviewer: { display_name: string } | null;
};

export type InvestorFilter = "pending" | "active" | "all";

export async function listInvestors(filter: InvestorFilter, q?: string): Promise<InvestorListRow[]> {
  let query = createAdminClient().from("investors").select(`${investorColumns}, reviewed_at`).order("created_at", { ascending: false }).limit(200);
  if (filter === "pending") query = query.eq("status", "PENDING");
  if (filter === "active") query = query.in("status", ["ACTIVE", "SUSPENDED"]);
  const term = (q ?? "").trim().replace(/[%_,()]/g, " ").slice(0, 60);
  if (term) query = query.or(`legal_name.ilike.%${term}%,email.ilike.%${term}%,phone.ilike.%${term}%,investor_number.ilike.%${term}%`);
  const { data } = await query;
  return (data ?? []) as InvestorListRow[];
}

export async function countPendingInvestors() {
  const { count } = await createAdminClient().from("investors").select("id", { count: "exact", head: true }).eq("status", "PENDING");
  return count ?? 0;
}

export async function getInvestor(id: string): Promise<InvestorDetail | null> {
  const { data } = await createAdminClient()
    .from("investors")
    .select(`${investorColumns}, notes, reviewed_by, reviewed_at, review_note, created_by, updated_at, reviewer:staff_members!investors_reviewed_by_fkey(display_name)`)
    .eq("id", id)
    .maybeSingle();
  return (data as unknown as InvestorDetail | null) ?? null;
}

export function isInvestorStatus(value: unknown): value is InvestorStatus {
  return (investorStatuses as readonly string[]).includes(String(value));
}
