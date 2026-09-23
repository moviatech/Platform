"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { can, requirePermission } from "@/lib/auth/staff";
import { scopeAllows } from "@/lib/auth/scope";
import { createAdminClient } from "@/lib/supabase/admin";
import { flawSlot, slotsFor, slotVisibility } from "./photo-slots";
import { privateBucket, publicBucket } from "./photos";

const maxBytes = 20 * 1024 * 1024;
const allowed = /^image\/(jpeg|png|webp)$/;
const uuid = z.uuid();

export type PhotoTarget = { path: string; url: string } | null;
export type PhotoResult = { ok?: boolean; error?: "invalid" | "forbidden" | "failed" };

async function photographer(vehicleId: string) {
  const session = await requirePermission("vehicle.view");
  if (!can(session, "vehicle.edit") && !can(session, "vehicle.inspect") && !can(session, "prep.manage")) return null;
  if (!uuid.safeParse(vehicleId).success || !(await scopeAllows(session, { vehicle: vehicleId }))) return null;
  return session;
}

async function slotsOf(vehicleId: string) {
  const { data } = await createAdminClient().from("vehicles").select("vehicle_class:vehicle_classes(model, slug)").eq("id", vehicleId).maybeSingle();
  return slotsFor((data as unknown as { vehicle_class: { model: string; slug: string } | null } | null)?.vehicle_class);
}

const bucketFor = (visibility: string) => (visibility === "CUSTOMER" ? publicBucket : privateBucket);
const prefix = (vehicleId: string, slot: string) => `baseline/${vehicleId}/${slot}-`;

export async function createPhotoUpload(vehicleId: string, slot: string, file: { type: string; size: number }): Promise<PhotoTarget> {
  if (!(await photographer(vehicleId))) return null;
  const slots = await slotsOf(vehicleId);
  if (slot !== flawSlot && !slots.some((item) => item.key === slot)) return null;
  if (!allowed.test(file.type) || file.size > maxBytes) return null;
  const path = `${prefix(vehicleId, slot)}${randomUUID()}.${file.type.split("/")[1].replace("jpeg", "jpg")}`;
  const { data } = await createAdminClient().storage.from(bucketFor(slotVisibility(slot, slots))).createSignedUploadUrl(path);
  return data ? { path, url: data.signedUrl } : null;
}

const saveInput = z.object({ vehicleId: uuid, slot: z.string().regex(/^[a-z_]{2,40}$/), path: z.string().max(200), type: z.string().regex(allowed), size: z.number().int().min(0).max(maxBytes), note: z.string().trim().max(200).optional() });

export async function savePhoto(input: { vehicleId: string; slot: string; path: string; type: string; size: number; note?: string }): Promise<PhotoResult> {
  const parsed = saveInput.safeParse(input);
  if (!parsed.success) return { error: "invalid" };
  const session = await photographer(parsed.data.vehicleId);
  if (!session) return { error: "forbidden" };
  const { vehicleId, slot, path, type, size, note } = parsed.data;
  const slots = await slotsOf(vehicleId);
  if ((slot !== flawSlot && !slots.some((item) => item.key === slot)) || !path.startsWith(prefix(vehicleId, slot))) return { error: "invalid" };
  if (slot === flawSlot && !note) return { error: "invalid" };
  const visibility = slotVisibility(slot, slots);
  const supabase = createAdminClient();
  const { data: previous } = slot === flawSlot ? { data: [] } : await supabase.from("vehicle_photos").select("id, storage_path, visibility").eq("vehicle_id", vehicleId).eq("slot", slot);
  if (previous?.length) await supabase.from("vehicle_photos").delete().in("id", previous.map((row) => row.id));
  const { error } = await supabase.from("vehicle_photos").insert({ vehicle_id: vehicleId, slot, visibility, storage_path: path, mime_type: type, size_bytes: size, note: slot === flawSlot ? note : null, created_by: session.userId });
  if (error) return { error: "failed" };
  for (const row of previous ?? []) await supabase.storage.from(bucketFor(row.visibility)).remove([row.storage_path]);
  await audit({ actorUserId: session.userId, actorType: "STAFF", action: previous?.length ? "vehicle.photo_replaced" : "vehicle.photo_added", entityType: "vehicle", entityId: vehicleId, metadata: { by: session.displayName, slot, note: note ?? undefined } });
  revalidatePath(`/ops/fleet/${vehicleId}`);
  revalidatePath("/ops/fleet");
  return { ok: true };
}

export async function removePhoto(vehicleId: string, photoId: string): Promise<PhotoResult> {
  if (!uuid.safeParse(photoId).success) return { error: "invalid" };
  const session = await photographer(vehicleId);
  if (!session) return { error: "forbidden" };
  const supabase = createAdminClient();
  const { data } = await supabase.from("vehicle_photos").select("id, slot, storage_path, visibility").eq("id", photoId).eq("vehicle_id", vehicleId).maybeSingle();
  if (!data) return { error: "invalid" };
  await supabase.from("vehicle_photos").delete().eq("id", data.id);
  await supabase.storage.from(bucketFor(data.visibility)).remove([data.storage_path]);
  await audit({ actorUserId: session.userId, actorType: "STAFF", action: "vehicle.photo_removed", entityType: "vehicle", entityId: vehicleId, metadata: { by: session.displayName, slot: data.slot } });
  revalidatePath(`/ops/fleet/${vehicleId}`);
  revalidatePath("/ops/fleet");
  return { ok: true };
}
