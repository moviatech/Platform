import "server-only";
import { flawSlot } from "@/features/fleet/photo-slots";
import { listCustomerPhotos } from "@/features/fleet/photos";
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

export type Media = { id: string; vehicle_id: string; kind: "IMAGE" | "VIDEO"; url: string; caption: string | null; mime_type: string };

export const mediaUrl = (path: string) => `${supabaseUrl}/storage/v1/object/public/vehicle-media/${path}`;

export async function listVehicleMedia(vehicleIds: string[], options: { baseline?: boolean } = {}): Promise<Record<string, Media[]>> {
  const ids = vehicleIds.filter(Boolean);
  if (!ids.length) return {};
  const supabase = createAdminClient();
  const [{ data }, baseline] = await Promise.all([
    supabase.from("vehicle_media").select("id, vehicle_id, kind, storage_path, caption, mime_type").in("vehicle_id", ids).order("sort_order").order("created_at"),
    options.baseline === false ? Promise.resolve({} as Awaited<ReturnType<typeof listCustomerPhotos>>) : listCustomerPhotos(ids),
  ]);
  const result: Record<string, Media[]> = {};
  for (const [vehicleId, photos] of Object.entries(baseline)) {
    result[vehicleId] = photos.filter((photo) => photo.slot !== flawSlot).map((photo) => ({ id: photo.id, vehicle_id: vehicleId, kind: "IMAGE" as const, url: photo.url, caption: null, mime_type: photo.mime_type }));
  }
  for (const row of data ?? []) {
    (result[row.vehicle_id] ??= []).push({ id: row.id, vehicle_id: row.vehicle_id, kind: row.kind as Media["kind"], url: mediaUrl(row.storage_path), caption: row.caption, mime_type: row.mime_type });
  }
  return result;
}
