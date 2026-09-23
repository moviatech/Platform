import "server-only";
import { supabaseUrl } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";

const classImages: Record<string, string> = {
  "model-y-basic": "/portal/vehicles/model-y-basic.webp",
  "model-y-premium": "/portal/vehicles/model-y-premium.webp",
  "model-y-l": "/portal/vehicles/model-y-l.webp",
  "cybertruck-basic": "/portal/vehicles/cybertruck-basic.webp",
  "cybertruck-premium": "/portal/vehicles/cybertruck-premium.webp",
};

export const classImage = (slug: string | null | undefined) => classImages[slug ?? ""] ?? classImages["model-y-premium"];

export type Media = { id: string; vehicle_id: string; kind: "IMAGE" | "VIDEO"; url: string; caption: string | null; mime_type: string };

export const mediaUrl = (path: string) => `${supabaseUrl}/storage/v1/object/public/vehicle-media/${path}`;

export async function listVehicleMedia(vehicleIds: string[]): Promise<Record<string, Media[]>> {
  const ids = vehicleIds.filter(Boolean);
  if (!ids.length) return {};
  const supabase = createAdminClient();
  const { data } = await supabase.from("vehicle_media").select("id, vehicle_id, kind, storage_path, caption, mime_type").in("vehicle_id", ids).order("sort_order").order("created_at");
  const result: Record<string, Media[]> = {};
  for (const row of data ?? []) {
    (result[row.vehicle_id] ??= []).push({ id: row.id, vehicle_id: row.vehicle_id, kind: row.kind as Media["kind"], url: mediaUrl(row.storage_path), caption: row.caption, mime_type: row.mime_type });
  }
  return result;
}
