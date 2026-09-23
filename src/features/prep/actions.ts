"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { requirePermission } from "@/lib/auth/staff";
import { sendEmail } from "@/lib/email";
import { rootDomain } from "@/lib/env";
import { presignUpload, r2Configured } from "@/lib/media/r2";
import { createAdminClient } from "@/lib/supabase/admin";
import { openPrepTask } from "./service";
import { prepItems, prepPhotoBucket, prepVideoRetentionDays, type PrepChecklist } from "./template";

export type PrepState = { ok?: boolean; error?: string };

const uuid = z.uuid();
const imageType = /^image\/(jpeg|png|webp|heic|heif)$/;
const videoType = /^video\/(mp4|quicktime|webm|x-m4v|3gpp)$/;
const maxPhotoBytes = 15 * 1024 * 1024;
const maxVideoBytes = 200 * 1024 * 1024;
const photoSchema = z.array(z.object({ path: z.string().max(200), type: z.string().regex(imageType), size: z.number().int().min(0).max(maxPhotoBytes) })).max(16);
const videoSchema = z.array(z.object({ key: z.string().max(200), type: z.string().regex(videoType), size: z.number().int().min(0).max(maxVideoBytes), duration: z.number().min(0).max(91) })).max(2);

const refresh = (id?: string) => {
  revalidatePath("/ops/prep", "layout");
  if (id) revalidatePath(`/ops/prep/${id}`);
};

function parseJson<T>(raw: FormDataEntryValue | null, schema: z.ZodType<T>, prefix: string, field: "path" | "key"): T | null {
  let parsed: unknown = [];
  try {
    parsed = raw ? JSON.parse(String(raw)) : [];
  } catch {
    return null;
  }
  const result = schema.safeParse(parsed);
  if (!result.success) return null;
  const items = result.data as unknown as Array<Record<string, string>>;
  return items.every((item) => item[field].startsWith(prefix)) ? result.data : null;
}

export async function createPrepTask(form: FormData) {
  const session = await requirePermission("prep.manage");
  const parsed = uuid.safeParse(form.get("vehicleId"));
  if (!parsed.success) return;
  const id = await openPrepTask(parsed.data, null, session.userId);
  if (id) await audit({ actorUserId: session.userId, actorType: "STAFF", action: "prep.created", entityType: "prep_task", entityId: id, metadata: { by: session.displayName, vehicleId: parsed.data } });
  refresh();
  if (id) redirect(`/prep/${id}`);
}

export async function startPrepTask(form: FormData) {
  const session = await requirePermission("prep.manage");
  const parsed = uuid.safeParse(form.get("taskId"));
  if (!parsed.success) return;
  await createAdminClient().from("prep_tasks").update({ status: "IN_PROGRESS", assigned_to: session.userId, started_at: new Date().toISOString() }).eq("id", parsed.data).neq("status", "DONE");
  await audit({ actorUserId: session.userId, actorType: "STAFF", action: "prep.started", entityType: "prep_task", entityId: parsed.data, metadata: { by: session.displayName } });
  refresh(parsed.data);
  redirect(`/prep/${parsed.data}`);
}

export async function createPrepUploads(taskId: string, phase: "BEFORE" | "AFTER", files: Array<{ type: string; size: number }>) {
  await requirePermission("prep.manage");
  if (!uuid.safeParse(taskId).success || files.length > 16) return files.map(() => null);
  const storage = createAdminClient().storage.from(prepPhotoBucket);
  const targets: Array<{ path: string; url: string } | null> = [];
  for (const file of files) {
    if (!imageType.test(file.type) || file.size > maxPhotoBytes) {
      targets.push(null);
      continue;
    }
    const path = `prep/${taskId}/${phase.toLowerCase()}/${randomUUID()}.${file.type.split("/")[1].replace("jpeg", "jpg")}`;
    const { data } = await storage.createSignedUploadUrl(path);
    targets.push(data ? { path, url: data.signedUrl } : null);
  }
  return targets;
}

export async function createPrepVideoUpload(taskId: string, file: { type: string; size: number }) {
  await requirePermission("prep.manage");
  if (!r2Configured() || !uuid.safeParse(taskId).success || !videoType.test(file.type) || file.size > maxVideoBytes) return null;
  const ext = file.type === "video/quicktime" ? "mov" : file.type === "video/x-m4v" ? "m4v" : file.type.split("/")[1];
  const key = `prep/${taskId}/${randomUUID()}.${ext}`;
  try {
    return { key, url: await presignUpload(key, file.type) };
  } catch {
    return null;
  }
}

const saveInput = z.object({
  taskId: uuid,
  notes: z.string().trim().max(2000),
  battery: z.union([z.literal(""), z.coerce.number().int().min(0).max(100)]),
  complete: z.enum(["0", "1"]),
});

export async function savePrepTask(_: PrepState, form: FormData): Promise<PrepState> {
  const session = await requirePermission("prep.manage");
  const parsed = saveInput.safeParse({ taskId: form.get("taskId"), notes: form.get("notes") ?? "", battery: form.get("battery") ?? "", complete: form.get("complete") ?? "0" });
  if (!parsed.success) return { error: "invalid" };
  const { taskId, notes, battery } = parsed.data;
  const before = parseJson(form.get("photosBefore"), photoSchema, `prep/${taskId}/before/`, "path");
  const after = parseJson(form.get("photosAfter"), photoSchema, `prep/${taskId}/after/`, "path");
  const videos = parseJson(form.get("videos"), videoSchema, `prep/${taskId}/`, "key");
  if (!before || !after || !videos) return { error: "invalid" };

  const supabase = createAdminClient();
  const { data: task } = await supabase.from("prep_tasks").select("id, vehicle_id, status, checklist").eq("id", taskId).maybeSingle();
  if (!task) return { error: "not_found" };
  if (task.status === "DONE") return { error: "already_done" };

  const now = new Date().toISOString();
  const previous = (task.checklist ?? {}) as PrepChecklist;
  const checklist: PrepChecklist = {};
  for (const item of prepItems) {
    const done = form.get(`item_${item}`) === "on";
    checklist[item] = done ? (previous[item]?.done ? previous[item] : { done: true, by: session.displayName, at: now }) : { done: false };
  }
  const complete = parsed.data.complete === "1";
  if (complete && prepItems.some((item) => !checklist[item]?.done)) return { error: "incomplete" };

  const photos = [...before.map((photo) => ({ ...photo, phase: "BEFORE" })), ...after.map((photo) => ({ ...photo, phase: "AFTER" }))];
  if (photos.length) {
    await supabase.from("prep_photos").insert(photos.map((photo) => ({ task_id: taskId, phase: photo.phase, storage_path: photo.path, mime_type: photo.type, size_bytes: photo.size, created_by: session.userId })));
  }
  if (videos.length) {
    await supabase.from("media").insert(
      videos.map((video) => ({
        kind: "VIDEO",
        scope: "PREP",
        vehicle_id: task.vehicle_id,
        prep_task_id: taskId,
        storage_key: video.key,
        content_type: video.type,
        size_bytes: video.size,
        duration_seconds: Math.round(video.duration),
        created_by: session.userId,
        expires_at: new Date(Date.now() + prepVideoRetentionDays * 86400000).toISOString(),
      })),
    );
  }

  await supabase
    .from("prep_tasks")
    .update({
      checklist,
      notes: notes || null,
      status: complete ? "DONE" : "IN_PROGRESS",
      assigned_to: session.userId,
      started_at: task.status === "OPEN" ? now : undefined,
      completed_at: complete ? now : null,
      completed_by: complete ? session.userId : null,
    })
    .eq("id", taskId);
  const vehiclePatch: Record<string, unknown> = {};
  if (battery !== "") vehiclePatch.battery_level = battery;
  if (complete) vehiclePatch.clean_state = "READY";
  if (Object.keys(vehiclePatch).length) await supabase.from("vehicles").update(vehiclePatch).eq("id", task.vehicle_id);
  await audit({ actorUserId: session.userId, actorType: "STAFF", action: complete ? "prep.completed" : "prep.updated", entityType: "prep_task", entityId: taskId, metadata: { by: session.displayName, vehicleId: task.vehicle_id, photos: photos.length, videos: videos.length, battery: battery === "" ? null : battery } });
  revalidatePath("/ops", "layout");
  refresh(taskId);
  if (complete) redirect("/prep");
  return { ok: true };
}

const issueInput = z.object({ taskId: uuid, issue: z.string().trim().min(1).max(2000) });

export async function reportPrepIssue(_: PrepState, form: FormData): Promise<PrepState> {
  const session = await requirePermission("prep.manage");
  const parsed = issueInput.safeParse({ taskId: form.get("taskId"), issue: form.get("issue") ?? "" });
  if (!parsed.success) return { error: "invalid" };
  const supabase = createAdminClient();
  const { data: task } = await supabase.from("prep_tasks").select("id, vehicle_id, vehicle:vehicles(fleet_number)").eq("id", parsed.data.taskId).maybeSingle();
  if (!task) return { error: "not_found" };
  await supabase.from("prep_tasks").update({ issue: parsed.data.issue, issue_open: true }).eq("id", parsed.data.taskId);
  await audit({ actorUserId: session.userId, actorType: "STAFF", action: "prep.issue_reported", entityType: "prep_task", entityId: parsed.data.taskId, metadata: { by: session.displayName, vehicleId: task.vehicle_id, issue: parsed.data.issue } });
  const notify = process.env.NOTIFY_EMAIL;
  const fleetNumber = (task.vehicle as unknown as { fleet_number: string } | null)?.fleet_number ?? "";
  if (notify) {
    await sendEmail({
      to: notify.split(",").map((item) => item.trim()).filter(Boolean),
      subject: `[Movia] 整备上报异常 / Prep issue · ${fleetNumber}`,
      text: [`${fleetNumber} · ${session.displayName}`, parsed.data.issue, `https://ops.${rootDomain}/prep/${parsed.data.taskId}`].join("\n"),
    }).catch(() => undefined);
  }
  revalidatePath("/ops", "layout");
  refresh(parsed.data.taskId);
  return { ok: true };
}

export async function resolvePrepIssue(form: FormData) {
  const session = await requirePermission("vehicle.edit");
  const parsed = uuid.safeParse(form.get("taskId"));
  if (!parsed.success) return;
  await createAdminClient().from("prep_tasks").update({ issue_open: false }).eq("id", parsed.data);
  await audit({ actorUserId: session.userId, actorType: "STAFF", action: "prep.issue_resolved", entityType: "prep_task", entityId: parsed.data, metadata: { by: session.displayName } });
  revalidatePath("/ops", "layout");
  refresh(parsed.data);
}
