import "server-only";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";

export const contributionKinds = ["CAPITAL", "VEHICLE"] as const;
export type ContributionKind = (typeof contributionKinds)[number];
export const contributionStatuses = ["REQUESTED", "CONFIRMED", "DECLINED", "CANCELLED"] as const;
export type ContributionStatus = (typeof contributionStatuses)[number];
export const allocationStatuses = ["ACTIVE", "EXITING", "ENDED"] as const;
export type AllocationStatus = (typeof allocationStatuses)[number];

export const vehiclePayloadSchema = z.object({
  model: z.string().trim().min(2).max(80),
  year: z.number().int().min(2015).max(2035),
  vin: z.string().trim().min(11).max(20),
  plate: z.string().trim().max(20).optional().default(""),
  color: z.string().trim().max(40).optional().default(""),
  mileage: z.number().int().min(0).max(1000000).optional(),
});

export type VehiclePayload = z.infer<typeof vehiclePayloadSchema>;

export type Contribution = {
  id: string;
  investor_id: string;
  kind: ContributionKind;
  status: ContributionStatus;
  amount_cents: number;
  received_cents: number | null;
  vehicle_payload: Partial<VehiclePayload>;
  note: string | null;
  bank_reference: string | null;
  decision_note: string | null;
  decided_at: string | null;
  created_at: string;
  investor?: { legal_name: string; investor_number: string } | null;
};

export type AllocationVehicle = {
  id: string;
  fleet_number: string;
  condition: string;
  clean_state: string;
  odometer: number | null;
  battery_level: number | null;
  year: number | null;
  exterior_color: string | null;
  vehicle_class: { slug: string; name: string; name_zh: string | null } | null;
};

export type Allocation = {
  id: string;
  investor_id: string;
  vehicle_id: string;
  contribution_id: string | null;
  source: ContributionKind;
  share_bps: number;
  revenue_share_bps: number;
  cost_basis_cents: number;
  effective_from: string;
  effective_to: string | null;
  status: AllocationStatus;
  exit_note: string | null;
  created_at: string;
  vehicle: AllocationVehicle | null;
  investor?: { id: string; legal_name: string; investor_number: string } | null;
};

const contributionColumns = "id, investor_id, kind, status, amount_cents, received_cents, vehicle_payload, note, bank_reference, decision_note, decided_at, created_at";
const allocationColumns = "id, investor_id, vehicle_id, contribution_id, source, share_bps, revenue_share_bps, cost_basis_cents, effective_from, effective_to, status, exit_note, created_at, vehicle:vehicles(id, fleet_number, condition, clean_state, odometer, battery_level, year, exterior_color, vehicle_class:vehicle_classes(slug, name, name_zh))";

export async function listContributions(investorId: string): Promise<Contribution[]> {
  const { data } = await createAdminClient().from("investor_contributions").select(contributionColumns).eq("investor_id", investorId).order("created_at", { ascending: false }).limit(100);
  return (data ?? []) as Contribution[];
}

export async function listPendingContributions(): Promise<Contribution[]> {
  const { data } = await createAdminClient().from("investor_contributions").select(`${contributionColumns}, investor:investors(legal_name, investor_number)`).eq("status", "REQUESTED").order("created_at").limit(100);
  return (data ?? []) as unknown as Contribution[];
}

export async function countPendingContributions() {
  const { count } = await createAdminClient().from("investor_contributions").select("id", { count: "exact", head: true }).eq("status", "REQUESTED");
  return count ?? 0;
}

export async function getContribution(id: string): Promise<Contribution | null> {
  const { data } = await createAdminClient().from("investor_contributions").select(contributionColumns).eq("id", id).maybeSingle();
  return (data as Contribution | null) ?? null;
}

export async function listAllocations(investorId: string, includeEnded = true): Promise<Allocation[]> {
  let query = createAdminClient().from("investor_allocations").select(allocationColumns).eq("investor_id", investorId).order("created_at", { ascending: false });
  if (!includeEnded) query = query.in("status", ["ACTIVE", "EXITING"]);
  const { data } = await query;
  return (data ?? []) as unknown as Allocation[];
}

export async function getAllocation(id: string): Promise<Allocation | null> {
  const { data } = await createAdminClient().from("investor_allocations").select(`${allocationColumns}, investor:investors(id, legal_name, investor_number)`).eq("id", id).maybeSingle();
  return (data as unknown as Allocation | null) ?? null;
}

export async function getVehicleAllocation(vehicleId: string): Promise<Allocation | null> {
  const { data } = await createAdminClient().from("investor_allocations").select(`${allocationColumns}, investor:investors(id, legal_name, investor_number)`).eq("vehicle_id", vehicleId).in("status", ["ACTIVE", "EXITING"]).maybeSingle();
  return (data as unknown as Allocation | null) ?? null;
}

export async function listActiveAllocationsForVehicles(vehicleIds: string[]): Promise<Allocation[]> {
  if (!vehicleIds.length) return [];
  const { data } = await createAdminClient().from("investor_allocations").select(`${allocationColumns}, investor:investors(id, legal_name, investor_number)`).in("vehicle_id", vehicleIds).in("status", ["ACTIVE", "EXITING"]);
  return (data ?? []) as unknown as Allocation[];
}

export type VehicleOption = { id: string; fleet_number: string; class_name: string; class_name_zh: string | null; allocated: boolean };

export async function listVehicleOptions(): Promise<VehicleOption[]> {
  const supabase = createAdminClient();
  const [{ data: vehicles }, { data: allocations }] = await Promise.all([
    supabase.from("vehicles").select("id, fleet_number, vehicle_class:vehicle_classes(name, name_zh)").order("fleet_number"),
    supabase.from("investor_allocations").select("vehicle_id").in("status", ["ACTIVE", "EXITING"]),
  ]);
  const taken = new Set((allocations ?? []).map((row) => row.vehicle_id));
  return ((vehicles ?? []) as unknown as Array<{ id: string; fleet_number: string; vehicle_class: { name: string; name_zh: string | null } | null }>).map((row) => ({
    id: row.id,
    fleet_number: row.fleet_number,
    class_name: row.vehicle_class?.name ?? "",
    class_name_zh: row.vehicle_class?.name_zh ?? null,
    allocated: taken.has(row.id),
  }));
}
