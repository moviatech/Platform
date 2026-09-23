import "server-only";
import { investorColumns, investorStatuses, type InvestorRow, type InvestorStatus } from "@/lib/auth/investor";
import { createAdminClient } from "@/lib/supabase/admin";
import { investorNames, memberPositions, type CompanyOption } from "./members";

export type InvestorListRow = InvestorRow & { reviewed_at: string | null; company: CompanyOption | null; members: number; stakeCents: number | null; ratio: number | null };

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
  const rows = (data ?? []) as Array<InvestorRow & { reviewed_at: string | null }>;
  const admin = createAdminClient();
  const companyIds = rows.filter((row) => row.kind === "COMPANY").map((row) => row.id);
  const { data: extra } = companyIds.length ? await admin.from("investors").select(`${investorColumns}, reviewed_at`).in("company_id", companyIds).order("created_at") : { data: [] };
  const seen = new Set(rows.map((row) => row.id));
  const all = [...rows, ...((extra ?? []) as Array<InvestorRow & { reviewed_at: string | null }>).filter((row) => !seen.has(row.id))];
  const members = all.filter((row) => row.company_id);
  const [names, positions] = await Promise.all([investorNames(members.map((row) => row.company_id)), memberPositions(members.map((row) => row.id))]);
  const counts = new Map<string, number>();
  for (const row of members) counts.set(row.company_id as string, (counts.get(row.company_id as string) ?? 0) + 1);
  const enriched = all.map((row) => ({
    ...row,
    company: row.company_id ? (names.get(row.company_id) ?? null) : null,
    members: counts.get(row.id) ?? 0,
    stakeCents: row.company_id ? (positions.get(row.id)?.stakeCents ?? 0) : null,
    ratio: row.company_id ? (positions.get(row.id)?.ratio ?? 0) : null,
  }));
  const allowed = filter === "pending" ? ["PENDING"] : filter === "active" ? ["ACTIVE", "SUSPENDED"] : null;
  const shown = allowed ? enriched.filter((row) => allowed.includes(row.status)) : enriched;
  const top = shown.filter((row) => !row.company_id || !shown.some((other) => other.id === row.company_id));
  return top.flatMap((row) => [row, ...shown.filter((other) => other.company_id === row.id).sort((a, b) => a.created_at.localeCompare(b.created_at))]);
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
