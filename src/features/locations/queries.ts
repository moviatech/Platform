import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

export type LocationRow = {
  id: string;
  code: string;
  name: string;
  name_zh: string | null;
  address: string | null;
  timezone: string;
  tax_rate_bps: number;
  active: boolean;
  pickup_instructions: string | null;
  pickup_instructions_zh: string | null;
  created_at: string;
  vehicles: number;
  reservations: number;
};

const columns = "id, code, name, name_zh, address, timezone, tax_rate_bps, active, pickup_instructions, pickup_instructions_zh, created_at";

export async function listLocations(): Promise<LocationRow[]> {
  const admin = createAdminClient();
  const [{ data: rows }, { data: vehicles }, { data: reservations }] = await Promise.all([
    admin.from("locations").select(columns).order("created_at"),
    admin.from("vehicles").select("location_id"),
    admin.from("reservations").select("pickup_location_id"),
  ]);
  const vehicleCounts = new Map<string, number>();
  for (const row of vehicles ?? []) vehicleCounts.set(row.location_id, (vehicleCounts.get(row.location_id) ?? 0) + 1);
  const reservationCounts = new Map<string, number>();
  for (const row of reservations ?? []) reservationCounts.set(row.pickup_location_id, (reservationCounts.get(row.pickup_location_id) ?? 0) + 1);
  return ((rows ?? []) as Array<Omit<LocationRow, "vehicles" | "reservations">>).map((row) => ({
    ...row,
    vehicles: vehicleCounts.get(row.id) ?? 0,
    reservations: reservationCounts.get(row.id) ?? 0,
  }));
}

export async function getLocation(id: string): Promise<LocationRow | null> {
  const { data } = await createAdminClient().from("locations").select(columns).eq("id", id).maybeSingle();
  return data ? ({ ...(data as Omit<LocationRow, "vehicles" | "reservations">), vehicles: 0, reservations: 0 } as LocationRow) : null;
}
