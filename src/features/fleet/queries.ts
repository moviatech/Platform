import "server-only";
import { createClient } from "@/lib/supabase/server";

import type { BlockRow, ClassOption, VehicleRow, VehicleTrip } from "./types";

const vehicleColumns =
  "id, class_id, location_id, fleet_number, vin, license_plate, year, exterior_color, condition, clean_state, battery_level, odometer, is_placeholder, notes, vehicle_class:vehicle_classes(id, slug, name, name_zh)";

export async function listVehicles(): Promise<VehicleRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("vehicles").select(vehicleColumns).order("fleet_number");
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as VehicleRow[];
}

export async function getVehicle(id: string): Promise<VehicleRow | null> {
  const supabase = await createClient();
  const { data } = await supabase.from("vehicles").select(vehicleColumns).eq("id", id).maybeSingle();
  return (data as unknown as VehicleRow | null) ?? null;
}

export async function listVehicleTrips(vehicleIds: string[]): Promise<Record<string, VehicleTrip[]>> {
  if (vehicleIds.length === 0) return {};
  const supabase = await createClient();
  const { data } = await supabase
    .from("reservations")
    .select("id, number, status, pickup_at, return_at, assigned_vehicle_id, customer:customers(full_name)")
    .in("assigned_vehicle_id", vehicleIds)
    .in("status", ["REQUESTED", "PENDING_PAYMENT", "CONFIRMED", "ACTIVE"])
    .gte("return_at", new Date(Date.now() - 86400000).toISOString())
    .order("pickup_at");
  const grouped: Record<string, VehicleTrip[]> = {};
  for (const row of (data ?? []) as unknown as Array<VehicleTrip & { assigned_vehicle_id: string }>) {
    (grouped[row.assigned_vehicle_id] ??= []).push(row);
  }
  return grouped;
}

export async function listBlocks(vehicleId: string): Promise<BlockRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("vehicle_blocks")
    .select("id, vehicle_id, starts_at, ends_at, type, reason")
    .eq("vehicle_id", vehicleId)
    .gte("ends_at", new Date().toISOString())
    .order("starts_at");
  return (data ?? []) as BlockRow[];
}

export async function listClassOptions(): Promise<ClassOption[]> {
  const supabase = await createClient();
  const { data } = await supabase.from("vehicle_classes").select("id, slug, name, name_zh, active").order("sort_order");
  return (data ?? []) as ClassOption[];
}
