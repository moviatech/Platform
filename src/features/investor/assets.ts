import "server-only";
import { classImage, listVehicleMedia } from "@/features/portal/garage";
import { createAdminClient } from "@/lib/supabase/admin";
import { listAllocations, type Allocation } from "./contributions";

export type LiveStatus = "AVAILABLE" | "RENTED" | "MAINTENANCE" | "ENDED";

export type AssetCard = Allocation & { cover: string; live: LiveStatus; className: string };

export async function liveStatuses(vehicleIds: string[]): Promise<Record<string, LiveStatus>> {
  if (!vehicleIds.length) return {};
  const supabase = createAdminClient();
  const [{ data: vehicles }, { data: active }] = await Promise.all([
    supabase.from("vehicles").select("id, condition").in("id", vehicleIds),
    supabase.from("reservations").select("assigned_vehicle_id").in("assigned_vehicle_id", vehicleIds).eq("status", "ACTIVE"),
  ]);
  const rented = new Set((active ?? []).map((row) => row.assigned_vehicle_id));
  const result: Record<string, LiveStatus> = {};
  for (const vehicle of vehicles ?? []) result[vehicle.id] = vehicle.condition !== "IN_SERVICE" ? "MAINTENANCE" : rented.has(vehicle.id) ? "RENTED" : "AVAILABLE";
  return result;
}

export async function listAssetCards(investorId: string, locale: string): Promise<AssetCard[]> {
  const allocations = await listAllocations(investorId);
  const vehicleIds = allocations.map((item) => item.vehicle_id);
  const [media, live] = await Promise.all([listVehicleMedia(vehicleIds), liveStatuses(vehicleIds)]);
  return allocations.map((allocation) => {
    const image = (media[allocation.vehicle_id] ?? []).find((item) => item.kind === "IMAGE");
    const slug = allocation.vehicle?.vehicle_class?.slug ?? null;
    return {
      ...allocation,
      cover: image?.url ?? classImage(slug),
      live: allocation.status === "ENDED" ? "ENDED" : (live[allocation.vehicle_id] ?? "AVAILABLE"),
      className: (locale === "zh" ? (allocation.vehicle?.vehicle_class?.name_zh ?? allocation.vehicle?.vehicle_class?.name) : allocation.vehicle?.vehicle_class?.name) ?? "",
    };
  });
}

export function assetSteps(allocation: Allocation, today: string): boolean[] {
  const started = allocation.effective_from <= today;
  const inService = allocation.vehicle?.condition === "IN_SERVICE";
  if (allocation.source === "VEHICLE") return [true, true, started && inService];
  return [true, true, inService || started, started && inService];
}
