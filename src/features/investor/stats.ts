import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Allocation } from "./contributions";

export type AssetStats = { monthShareCents: number; utilization: number | null; settledCents: number; rentedDays: number; availableDays: number };

const zone = "America/Los_Angeles";

export function monthBounds(month: string) {
  const [y, m] = month.split("-").map(Number);
  const start = new Date(Date.UTC(y, m - 1, 1, 8));
  const end = new Date(Date.UTC(y, m, 1, 8));
  return { start, end, days: Math.round((end.getTime() - start.getTime()) / 86400000) };
}

const dayKey = (date: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);

export async function rentedDaysByVehicle(vehicleIds: string[], month: string): Promise<Record<string, { rented: Set<string>; maintenance: Set<string> }>> {
  const result: Record<string, { rented: Set<string>; maintenance: Set<string> }> = {};
  if (!vehicleIds.length) return result;
  const { start, end } = monthBounds(month);
  const supabase = createAdminClient();
  const [{ data: reservations }, { data: blocks }] = await Promise.all([
    supabase.from("reservations").select("assigned_vehicle_id, pickup_at, return_at, actual_pickup_at, actual_return_at, status").in("assigned_vehicle_id", vehicleIds).in("status", ["ACTIVE", "COMPLETED"]).lt("pickup_at", end.toISOString()).gt("return_at", start.toISOString()),
    supabase.from("vehicle_blocks").select("vehicle_id, starts_at, ends_at, type").in("vehicle_id", vehicleIds).lt("starts_at", end.toISOString()).gt("ends_at", start.toISOString()),
  ]);
  const mark = (vehicleId: string, from: string, to: string, kind: "rented" | "maintenance") => {
    const entry = (result[vehicleId] ??= { rented: new Set(), maintenance: new Set() });
    let cursor = Math.max(Date.parse(from), start.getTime());
    const stop = Math.min(Date.parse(to), end.getTime());
    while (cursor < stop) {
      entry[kind].add(dayKey(new Date(cursor)));
      cursor += 86400000;
    }
    if (stop > Math.max(Date.parse(from), start.getTime())) entry[kind].add(dayKey(new Date(Math.max(Date.parse(from), start.getTime()))));
  };
  for (const row of reservations ?? []) if (row.assigned_vehicle_id) mark(row.assigned_vehicle_id, row.actual_pickup_at ?? row.pickup_at, row.actual_return_at ?? row.return_at, "rented");
  for (const row of blocks ?? []) if (row.type === "MAINTENANCE") mark(row.vehicle_id, row.starts_at, row.ends_at, "maintenance");
  return result;
}

export async function loadAssetStats(allocations: Allocation[], month: string): Promise<Record<string, AssetStats>> {
  const result: Record<string, AssetStats> = {};
  if (!allocations.length) return result;
  const { start, end, days } = monthBounds(month);
  const supabase = createAdminClient();
  const ids = allocations.map((item) => item.id);
  const [{ data: monthRows }, { data: settledRows }, usage] = await Promise.all([
    supabase.from("investor_ledger_entries").select("allocation_id, amount_cents, type").in("allocation_id", ids).eq("type", "RENTAL_SHARE").gte("created_at", start.toISOString()).lt("created_at", end.toISOString()),
    supabase.from("investor_ledger_entries").select("allocation_id, amount_cents").in("allocation_id", ids).in("type", ["RENTAL_SHARE", "ADJUSTMENT", "REVERSAL"]).eq("bucket", "AVAILABLE"),
    rentedDaysByVehicle(allocations.map((item) => item.vehicle_id), month),
  ]);
  for (const allocation of allocations) {
    const monthShare = (monthRows ?? []).filter((row) => row.allocation_id === allocation.id).reduce((sum, row) => sum + row.amount_cents, 0);
    const settled = (settledRows ?? []).filter((row) => row.allocation_id === allocation.id).reduce((sum, row) => sum + row.amount_cents, 0);
    const use = usage[allocation.vehicle_id];
    const effectiveStart = Math.max(start.getTime(), Date.parse(`${allocation.effective_from}T08:00:00Z`));
    const effectiveEnd = allocation.effective_to ? Math.min(end.getTime(), Date.parse(`${allocation.effective_to}T08:00:00Z`) + 86400000) : end.getTime();
    const activeDays = Math.max(0, Math.round((effectiveEnd - effectiveStart) / 86400000));
    const maintenanceDays = use?.maintenance.size ?? 0;
    const availableDays = Math.max(0, Math.min(days, activeDays) - maintenanceDays);
    const rentedDays = use?.rented.size ?? 0;
    result[allocation.id] = {
      monthShareCents: monthShare,
      settledCents: settled,
      rentedDays,
      availableDays,
      utilization: availableDays > 0 ? Math.min(100, Math.round((rentedDays / availableDays) * 100)) : null,
    };
  }
  return result;
}
