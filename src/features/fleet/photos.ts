import "server-only";
import { supabaseUrl } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import { flawSlot, slotsFor, type PhotoSlot } from "./photo-slots";

export const publicBucket = "vehicle-media";
export const privateBucket = "vehicle-archive";

export type VehiclePhoto = { id: string; vehicle_id: string; slot: string; visibility: "CUSTOMER" | "INTERNAL"; url: string; note: string | null; mime_type: string; created_at: string };

type Row = { id: string; vehicle_id: string; slot: string; visibility: "CUSTOMER" | "INTERNAL"; storage_path: string; note: string | null; mime_type: string; created_at: string };

const columns = "id, vehicle_id, slot, visibility, storage_path, note, mime_type, created_at";
const publicUrl = (path: string) => `${supabaseUrl}/storage/v1/object/public/${publicBucket}/${path}`;

export async function listVehiclePhotos(vehicleId: string): Promise<VehiclePhoto[]> {
  const supabase = createAdminClient();
  const { data } = await supabase.from("vehicle_photos").select(columns).eq("vehicle_id", vehicleId).order("created_at");
  const rows = (data ?? []) as Row[];
  const internal = rows.filter((row) => row.visibility === "INTERNAL");
  const signed = new Map<string, string>();
  if (internal.length) {
    const { data: urls } = await supabase.storage.from(privateBucket).createSignedUrls(internal.map((row) => row.storage_path), 3600);
    for (const item of urls ?? []) if (item.path && item.signedUrl) signed.set(item.path, item.signedUrl);
  }
  return rows.map((row) => ({ id: row.id, vehicle_id: row.vehicle_id, slot: row.slot, visibility: row.visibility, url: row.visibility === "CUSTOMER" ? publicUrl(row.storage_path) : (signed.get(row.storage_path) ?? ""), note: row.note, mime_type: row.mime_type, created_at: row.created_at }));
}

export type CustomerPhoto = { id: string; vehicle_id: string; slot: string; url: string; note: string | null; mime_type: string };

export async function listCustomerPhotos(vehicleIds: string[]): Promise<Record<string, CustomerPhoto[]>> {
  const ids = vehicleIds.filter(Boolean);
  const result: Record<string, CustomerPhoto[]> = {};
  if (!ids.length) return result;
  const supabase = createAdminClient();
  const [{ data }, { data: vehicles }] = await Promise.all([
    supabase.from("vehicle_photos").select(columns).in("vehicle_id", ids).eq("visibility", "CUSTOMER").order("created_at"),
    supabase.from("vehicles").select("id, vehicle_class:vehicle_classes(model, slug)").in("id", ids),
  ]);
  const order = new Map<string, string[]>();
  for (const vehicle of (vehicles ?? []) as unknown as Array<{ id: string; vehicle_class: { model: string; slug: string } | null }>) order.set(vehicle.id, slotsFor(vehicle.vehicle_class).map((slot) => slot.key));
  for (const row of (data ?? []) as Row[]) (result[row.vehicle_id] ??= []).push({ id: row.id, vehicle_id: row.vehicle_id, slot: row.slot, url: publicUrl(row.storage_path), note: row.note, mime_type: row.mime_type });
  for (const [vehicleId, photos] of Object.entries(result)) {
    const keys = order.get(vehicleId) ?? [];
    const rank = (slot: string) => (slot === flawSlot ? 999 : keys.indexOf(slot) < 0 ? 998 : keys.indexOf(slot));
    photos.sort((a, b) => rank(a.slot) - rank(b.slot));
  }
  return result;
}

export type PhotoProgress = { done: number; total: number; missing: string[] };

export function progressOf(slots: PhotoSlot[], taken: Iterable<string>): PhotoProgress {
  const have = new Set(taken);
  const missing = slots.filter((slot) => !have.has(slot.key)).map((slot) => slot.key);
  return { done: slots.length - missing.length, total: slots.length, missing };
}

export async function photoProgress(vehicles: Array<{ id: string; vehicle_class: { model?: string | null; slug?: string | null } | null }>): Promise<Record<string, PhotoProgress>> {
  const result: Record<string, PhotoProgress> = {};
  if (!vehicles.length) return result;
  const { data } = await createAdminClient().from("vehicle_photos").select("vehicle_id, slot").in("vehicle_id", vehicles.map((vehicle) => vehicle.id)).neq("slot", flawSlot);
  const taken = new Map<string, string[]>();
  for (const row of data ?? []) taken.set(row.vehicle_id, [...(taken.get(row.vehicle_id) ?? []), row.slot]);
  for (const vehicle of vehicles) result[vehicle.id] = progressOf(slotsFor(vehicle.vehicle_class), taken.get(vehicle.id) ?? []);
  return result;
}

export async function vehiclePhotoProgress(vehicleId: string): Promise<PhotoProgress> {
  const { data } = await createAdminClient().from("vehicles").select("id, vehicle_class:vehicle_classes(model, slug)").eq("id", vehicleId).maybeSingle();
  const vehicle = data as unknown as { id: string; vehicle_class: { model: string; slug: string } | null } | null;
  if (!vehicle) return { done: 0, total: 0, missing: [] };
  return (await photoProgress([vehicle]))[vehicleId];
}
