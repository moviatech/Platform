"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { requirePermission } from "@/lib/auth/staff";
import { createAdminClient } from "@/lib/supabase/admin";

const bucket = "vehicle-media";
const maxBytes = 50 * 1024 * 1024;
const allowed = /^(image\/(jpeg|png|webp)|video\/(mp4|webm|quicktime))$/;
const uuid = z.uuid();

export type MediaTarget = { path: string; url: string } | null;

export async function createMediaUploads(vehicleId: string, files: Array<{ type: string; size: number }>): Promise<MediaTarget[]> {
  await requirePermission("vehicle.edit");
  if (!uuid.safeParse(vehicleId).success || files.length > 20) return files.map(() => null);
  const storage = createAdminClient().storage.from(bucket);
  const targets: MediaTarget[] = [];
  for (const file of files) {
    if (!allowed.test(file.type) || file.size > maxBytes) {
      targets.push(null);
      continue;
    }
    const ext = file.type.split("/")[1].replace("jpeg", "jpg").replace("quicktime", "mov");
    const path = `${vehicleId}/${randomUUID()}.${ext}`;
    const { data } = await storage.createSignedUploadUrl(path);
    targets.push(data ? { path, url: data.signedUrl } : null);
  }
  return targets;
}

const saveInput = z.object({
  vehicleId: uuid,
  items: z.array(z.object({ path: z.string().max(200), type: z.string().regex(allowed), size: z.number().int().min(0).max(maxBytes) })).max(20),
});

export async function saveMedia(vehicleId: string, items: Array<{ path: string; type: string; size: number }>): Promise<{ ok?: boolean; error?: string }> {
  const session = await requirePermission("vehicle.edit");
  const parsed = saveInput.safeParse({ vehicleId, items });
  if (!parsed.success) return { error: "invalid" };
  const valid = parsed.data.items.filter((item) => item.path.startsWith(`${vehicleId}/`));
  if (!valid.length) return { ok: true };
  const supabase = createAdminClient();
  const { count } = await supabase.from("vehicle_media").select("id", { count: "exact", head: true }).eq("vehicle_id", vehicleId);
  const { error } = await supabase.from("vehicle_media").insert(
    valid.map((item, index) => ({
      vehicle_id: vehicleId,
      kind: item.type.startsWith("video/") ? "VIDEO" : "IMAGE",
      storage_path: item.path,
      mime_type: item.type,
      sort_order: (count ?? 0) + index,
      created_by: session.userId,
    })),
  );
  if (error) return { error: "failed" };
  await audit({ actorUserId: session.userId, actorType: "STAFF", action: "vehicle.media_added", entityType: "vehicle", entityId: vehicleId, metadata: { by: session.displayName, count: valid.length } });
  revalidatePath(`/ops/fleet/${vehicleId}`);
  return { ok: true };
}

export async function removeMedia(form: FormData) {
  const session = await requirePermission("vehicle.edit");
  const parsed = z.object({ mediaId: uuid, vehicleId: uuid }).safeParse({ mediaId: form.get("mediaId"), vehicleId: form.get("vehicleId") });
  if (!parsed.success) return;
  const supabase = createAdminClient();
  const { data } = await supabase.from("vehicle_media").select("storage_path").eq("id", parsed.data.mediaId).eq("vehicle_id", parsed.data.vehicleId).maybeSingle();
  if (!data) return;
  await supabase.from("vehicle_media").delete().eq("id", parsed.data.mediaId);
  await supabase.storage.from(bucket).remove([data.storage_path]);
  await audit({ actorUserId: session.userId, actorType: "STAFF", action: "vehicle.media_removed", entityType: "vehicle", entityId: parsed.data.vehicleId, metadata: { by: session.displayName } });
  revalidatePath(`/ops/fleet/${parsed.data.vehicleId}`);
}
