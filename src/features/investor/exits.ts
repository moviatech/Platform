import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

export type ExitRequest = { id: string; investor_id: string; allocation_id: string; reason: string | null; status: "REQUESTED" | "IN_PROGRESS" | "RESOLVED" | "DECLINED"; resolution_note: string | null; resolved_at: string | null; created_at: string };

const columns = "id, investor_id, allocation_id, reason, status, resolution_note, resolved_at, created_at";

export async function listExitRequests(investorId: string): Promise<ExitRequest[]> {
  const { data } = await createAdminClient().from("investor_exit_requests").select(columns).eq("investor_id", investorId).order("created_at", { ascending: false });
  return (data ?? []) as ExitRequest[];
}

export async function getActiveExit(allocationId: string): Promise<ExitRequest | null> {
  const { data } = await createAdminClient().from("investor_exit_requests").select(columns).eq("allocation_id", allocationId).in("status", ["REQUESTED", "IN_PROGRESS"]).order("created_at", { ascending: false }).limit(1).maybeSingle();
  return (data as ExitRequest | null) ?? null;
}

export type OpenExit = ExitRequest & { investor: { legal_name: string; investor_number: string } | null; allocation: { vehicle: { fleet_number: string } | null } | null };

export async function listOpenExits(): Promise<OpenExit[]> {
  const { data } = await createAdminClient().from("investor_exit_requests").select(`${columns}, investor:investors(legal_name, investor_number), allocation:investor_allocations(vehicle:vehicles(fleet_number))`).in("status", ["REQUESTED", "IN_PROGRESS"]).order("created_at");
  return (data ?? []) as unknown as OpenExit[];
}

export async function countPendingExits() {
  const { count } = await createAdminClient().from("investor_exit_requests").select("id", { count: "exact", head: true }).in("status", ["REQUESTED", "IN_PROGRESS"]);
  return count ?? 0;
}
