import "server-only";
import { supabaseUrl } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import { flawSlot, showcaseSlotsFor, slotsFor, type PhotoSlot } from "./photo-slots";

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

export type ClassPhoto = { id: string; class_id: string; slot: string; url: string; note: null; mime_type: string };

type ClassRef = { id: string; model: string; slug: string };

export async function listClassPhotos(classes: ClassRef[]): Promise<Record<string, ClassPhoto[]>> {
  const result: Record<string, ClassPhoto[]> = {};
  if (!classes.length) return result;
  const { data } = await createAdminClient().from("vehicle_class_photos").select("id, class_id, slot, storage_path, mime_type").in("class_id", classes.map((item) => item.id));
  for (const item of classes) {
    const keys = showcaseSlotsFor(item).map((slot) => slot.key);
    const rows = (data ?? []).filter((row) => row.class_id === item.id && keys.includes(row.slot)).sort((a, b) => keys.indexOf(a.slot) - keys.indexOf(b.slot));
    if (rows.length) result[item.id] = rows.map((row) => ({ id: row.id, class_id: row.class_id, slot: row.slot, url: publicUrl(row.storage_path), note: null, mime_type: row.mime_type }));
  }
  return result;
}

export type CustomerPhoto = { id: string; vehicle_id: string; slot: string; url: string; note: string | null; mime_type: string; sample: boolean };

export async function listCustomerPhotos(vehicleIds: string[], options: { samples?: boolean } = {}): Promise<Record<string, CustomerPhoto[]>> {
  const ids = vehicleIds.filter(Boolean);
  const result: Record<string, CustomerPhoto[]> = {};
  if (!ids.length) return result;
  const supabase = createAdminClient();
  const [{ data }, { data: vehicles }] = await Promise.all([
    supabase.from("vehicle_photos").select(columns).in("vehicle_id", ids).eq("visibility", "CUSTOMER").order("created_at"),
    supabase.from("vehicles").select("id, vehicle_class:vehicle_classes(id, model, slug)").in("id", ids),
  ]);
  const fleet = (vehicles ?? []) as unknown as Array<{ id: string; vehicle_class: ClassRef | null }>;
  const order = new Map<string, string[]>();
  for (const vehicle of fleet) order.set(vehicle.id, slotsFor(vehicle.vehicle_class).map((slot) => slot.key));
  for (const row of (data ?? []) as Row[]) (result[row.vehicle_id] ??= []).push({ id: row.id, vehicle_id: row.vehicle_id, slot: row.slot, url: publicUrl(row.storage_path), note: row.note, mime_type: row.mime_type, sample: false });
  if (options.samples) {
    const bare = fleet.filter((vehicle) => vehicle.vehicle_class && !(result[vehicle.id] ?? []).some((photo) => photo.slot !== flawSlot));
    const library = await listClassPhotos([...new Map(bare.map((vehicle) => [vehicle.vehicle_class!.id, vehicle.vehicle_class!])).values()]);
    for (const vehicle of bare) {
      const samples = library[vehicle.vehicle_class!.id] ?? [];
      if (samples.length) (result[vehicle.id] ??= []).push(...samples.map((photo) => ({ id: photo.id, vehicle_id: vehicle.id, slot: photo.slot, url: photo.url, note: null, mime_type: photo.mime_type, sample: true })));
    }
  }
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
  const admin = createAdminClient();
  const [{ data }, { data: rows }] = await Promise.all([
    admin.from("vehicles").select("id, vehicle_class:vehicle_classes(model, slug)").eq("id", vehicleId).maybeSingle(),
    admin.from("vehicle_photos").select("slot").eq("vehicle_id", vehicleId).neq("slot", flawSlot),
  ]);
  const vehicle = data as unknown as { id: string; vehicle_class: { model: string; slug: string } | null } | null;
  if (!vehicle) return { done: 0, total: 0, missing: [] };
  return progressOf(slotsFor(vehicle.vehicle_class), (rows ?? []).map((row) => row.slot));
}
