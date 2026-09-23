"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { can, requirePermission } from "@/lib/auth/staff";
import { createAdminClient } from "@/lib/supabase/admin";
import type { PhotoResult, PhotoTarget } from "./photo-actions";
import { showcaseSlotsFor } from "./photo-slots";
import { publicBucket } from "./photos";
import { videoLink, videoRef } from "./video";

const maxBytes = 20 * 1024 * 1024;
const allowed = /^image\/(jpeg|png|webp)$/;
const uuid = z.uuid();
const page = "/ops/fleet/library";

async function librarian() {
  const session = await requirePermission("vehicle.view");
  return can(session, "vehicle.edit") && session.locationIds === null ? session : null;
}

async function slotsOf(classId: string) {
  const { data } = await createAdminClient().from("vehicle_classes").select("model, slug").eq("id", classId).maybeSingle();
  return data ? showcaseSlotsFor(data) : [];
}

const prefix = (classId: string, slot: string) => `class/${classId}/${slot}-`;

export async function createClassPhotoUpload(classId: string, slot: string, file: { type: string; size: number }): Promise<PhotoTarget> {
  if (!uuid.safeParse(classId).success || !(await librarian())) return null;
  if (!(await slotsOf(classId)).some((item) => item.key === slot)) return null;
  if (!allowed.test(file.type) || file.size > maxBytes) return null;
  const path = `${prefix(classId, slot)}${randomUUID()}.${file.type.split("/")[1].replace("jpeg", "jpg")}`;
  const { data } = await createAdminClient().storage.from(publicBucket).createSignedUploadUrl(path);
  return data ? { path, url: data.signedUrl } : null;
}

const saveInput = z.object({ classId: uuid, slot: z.string().regex(/^[a-z_]{2,40}$/), path: z.string().max(200), type: z.string().regex(allowed), size: z.number().int().min(0).max(maxBytes) });

export async function saveClassPhoto(input: { classId: string; slot: string; path: string; type: string; size: number }): Promise<PhotoResult> {
  const parsed = saveInput.safeParse(input);
  if (!parsed.success) return { error: "invalid" };
  const session = await librarian();
  if (!session) return { error: "forbidden" };
  const { classId, slot, path, type, size } = parsed.data;
  if (!(await slotsOf(classId)).some((item) => item.key === slot) || !path.startsWith(prefix(classId, slot))) return { error: "invalid" };
  const supabase = createAdminClient();
  const { data: previous } = await supabase.from("vehicle_class_photos").select("id, storage_path").eq("class_id", classId).eq("slot", slot);
  if (previous?.length) await supabase.from("vehicle_class_photos").delete().in("id", previous.map((row) => row.id));
  const { error } = await supabase.from("vehicle_class_photos").insert({ class_id: classId, slot, storage_path: path, mime_type: type, size_bytes: size, created_by: session.userId });
  if (error) return { error: "failed" };
  if (previous?.length) await supabase.storage.from(publicBucket).remove(previous.map((row) => row.storage_path));
  await audit({ actorUserId: session.userId, actorType: "STAFF", action: previous?.length ? "class.photo_replaced" : "class.photo_added", entityType: "vehicle_class", entityId: classId, metadata: { by: session.displayName, slot } });
  revalidatePath(page);
  return { ok: true };
}

export async function removeClassPhoto(classId: string, photoId: string): Promise<PhotoResult> {
  if (!uuid.safeParse(classId).success || !uuid.safeParse(photoId).success) return { error: "invalid" };
  const session = await librarian();
  if (!session) return { error: "forbidden" };
  const supabase = createAdminClient();
  const { data } = await supabase.from("vehicle_class_photos").select("id, slot, storage_path").eq("id", photoId).eq("class_id", classId).maybeSingle();
  if (!data) return { error: "invalid" };
  await supabase.from("vehicle_class_photos").delete().eq("id", data.id);
  await supabase.storage.from(publicBucket).remove([data.storage_path]);
  await audit({ actorUserId: session.userId, actorType: "STAFF", action: "class.photo_removed", entityType: "vehicle_class", entityId: classId, metadata: { by: session.displayName, slot: data.slot } });
  revalidatePath(page);
  return { ok: true };
}

export type ClassVideoState = { ok?: boolean; error?: "invalid" | "forbidden" | "video" | "failed"; value?: string };

export async function saveClassVideo(_: ClassVideoState, form: FormData): Promise<ClassVideoState> {
  const parsed = z.object({ classId: uuid, videoUrl: z.string().trim().max(200) }).safeParse({ classId: form.get("classId"), videoUrl: form.get("videoUrl") ?? "" });
  if (!parsed.success) return { error: "invalid" };
  const session = await librarian();
  if (!session) return { error: "forbidden" };
  const ref = parsed.data.videoUrl ? videoRef(parsed.data.videoUrl) : null;
  const link = ref ? videoLink(ref) : null;
  if (parsed.data.videoUrl && !link) return { error: "video", value: parsed.data.videoUrl };
  const { data, error } = await createAdminClient().from("vehicle_classes").update({ video_url: link }).eq("id", parsed.data.classId).select("id");
  if (error || !data?.length) return { error: "failed", value: parsed.data.videoUrl };
  await audit({ actorUserId: session.userId, actorType: "STAFF", action: "class.video_updated", entityType: "vehicle_class", entityId: parsed.data.classId, metadata: { by: session.displayName, video: link } });
  revalidatePath(page);
  return { ok: true };
}
