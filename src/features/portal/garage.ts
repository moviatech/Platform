import "server-only";
import { flawSlot } from "@/features/fleet/photo-slots";
import { listClassPhotos, listCustomerPhotos } from "@/features/fleet/photos";
import { videoEmbed, videoRef } from "@/features/fleet/video";
import { supabaseUrl } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";

const classImages: Record<string, string> = {
  "model-3": "/portal/vehicles/model-3.webp",
  "model-y-basic": "/portal/vehicles/model-y-basic.webp",
  "model-y-premium": "/portal/vehicles/model-y-premium.webp",
  "model-y-l": "/portal/vehicles/model-y-l.webp",
  "cybertruck-basic": "/portal/vehicles/cybertruck-basic.webp",
  "cybertruck-premium": "/portal/vehicles/cybertruck-premium.webp",
};

export const classImage = (slug: string | null | undefined) => classImages[slug ?? ""] ?? classImages["model-y-premium"];

export type Media = { id: string; vehicle_id: string; kind: "IMAGE" | "VIDEO"; url: string; caption: string | null; mime_type: string; slot: string | null; sample: boolean };

export const mediaUrl = (path: string) => `${supabaseUrl}/storage/v1/object/public/vehicle-media/${path}`;

type Walkable = { assigned_vehicle_id: string | null; vehicle: { video_url: string | null; vehicle_class: { video_url: string | null } | null } | null; vehicle_class: { video_url: string | null } | null };

export function walkaroundOf(trip: Walkable) {
  const own = videoRef(trip.vehicle?.video_url);
  const shared = own ? null : videoRef(trip.assigned_vehicle_id ? trip.vehicle?.vehicle_class?.video_url : trip.vehicle_class?.video_url);
  const ref = own ?? shared;
  return { id: ref ? `${ref.provider}:${ref.id}` : null, embed: ref ? videoEmbed(ref) : null, sample: Boolean(shared) };
}

export async function listClassMedia(vehicleClass: { id: string; model: string; slug: string } | null | undefined): Promise<Media[]> {
  if (!vehicleClass) return [];
  const photos = (await listClassPhotos([vehicleClass]))[vehicleClass.id] ?? [];
  return photos.map((photo) => ({ id: photo.id, vehicle_id: "", kind: "IMAGE" as const, url: photo.url, caption: null, mime_type: photo.mime_type, slot: photo.slot, sample: true }));
}

export async function listVehicleMedia(vehicleIds: string[], options: { baseline?: boolean; samples?: boolean } = {}): Promise<Record<string, Media[]>> {
  const ids = vehicleIds.filter(Boolean);
  if (!ids.length) return {};
  const supabase = createAdminClient();
  const [{ data }, baseline] = await Promise.all([
    supabase.from("vehicle_media").select("id, vehicle_id, kind, storage_path, caption, mime_type").in("vehicle_id", ids).order("sort_order").order("created_at"),
    options.baseline === false ? Promise.resolve({} as Awaited<ReturnType<typeof listCustomerPhotos>>) : listCustomerPhotos(ids, { samples: options.samples }),
  ]);
  const result: Record<string, Media[]> = {};
  for (const [vehicleId, photos] of Object.entries(baseline)) {
    result[vehicleId] = photos.filter((photo) => photo.slot !== flawSlot).map((photo) => ({ id: photo.id, vehicle_id: vehicleId, kind: "IMAGE" as const, url: photo.url, caption: null, mime_type: photo.mime_type, slot: photo.slot, sample: photo.sample }));
  }
  for (const row of data ?? []) {
    (result[row.vehicle_id] ??= []).push({ id: row.id, vehicle_id: row.vehicle_id, kind: row.kind as Media["kind"], url: mediaUrl(row.storage_path), caption: row.caption, mime_type: row.mime_type, slot: null, sample: false });
  }
  for (const [vehicleId, items] of Object.entries(result)) {
    if (items.some((item) => item.sample) && items.some((item) => !item.sample && item.kind === "IMAGE")) result[vehicleId] = items.filter((item) => !item.sample);
  }
  return result;
}
