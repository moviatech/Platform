import "server-only";
import type { CleanState, VehicleCondition } from "@/features/fleet/types";
import { presignDownload, r2Configured } from "@/lib/media/r2";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { prepPhotoBucket, type PrepChecklist, type PrepStatus } from "./template";

export type BoardVehicle = {
  id: string;
  fleet_number: string;
  license_plate: string | null;
  condition: VehicleCondition;
  clean_state: CleanState;
  battery_level: number | null;
  vehicle_class: { name: string; name_zh: string | null } | null;
  task: { id: string; status: PrepStatus; checklist: PrepChecklist; due_at: string | null; issue_open: boolean; assignee: string | null } | null;
  next_pickup_at: string | null;
};

export async function listPrepBoard(): Promise<BoardVehicle[]> {
  const supabase = await createClient();
  const now = new Date().toISOString();
  const [{ data: vehicles }, { data: tasks }, { data: upcoming }] = await Promise.all([
    supabase.from("vehicles").select("id, fleet_number, license_plate, condition, clean_state, battery_level, vehicle_class:vehicle_classes(name, name_zh)").order("fleet_number"),
    supabase.from("prep_tasks").select("id, vehicle_id, status, checklist, due_at, issue_open, assignee:staff_members!prep_tasks_assigned_to_fkey(display_name)").neq("status", "DONE"),
    supabase.from("reservations").select("assigned_vehicle_id, pickup_at").in("status", ["CONFIRMED", "REQUESTED", "PENDING_PAYMENT"]).gt("pickup_at", now).order("pickup_at"),
  ]);
  const taskByVehicle = new Map<string, NonNullable<BoardVehicle["task"]>>();
  for (const row of (tasks ?? []) as unknown as Array<{ id: string; vehicle_id: string; status: PrepStatus; checklist: PrepChecklist; due_at: string | null; issue_open: boolean; assignee: { display_name: string } | null }>) {
    if (!taskByVehicle.has(row.vehicle_id)) taskByVehicle.set(row.vehicle_id, { id: row.id, status: row.status, checklist: row.checklist ?? {}, due_at: row.due_at, issue_open: row.issue_open, assignee: row.assignee?.display_name ?? null });
  }
  const nextByVehicle = new Map<string, string>();
  for (const row of upcoming ?? []) if (row.assigned_vehicle_id && !nextByVehicle.has(row.assigned_vehicle_id)) nextByVehicle.set(row.assigned_vehicle_id, row.pickup_at);
  return ((vehicles ?? []) as unknown as Array<Omit<BoardVehicle, "task" | "next_pickup_at">>).map((vehicle) => ({
    ...vehicle,
    task: taskByVehicle.get(vehicle.id) ?? null,
    next_pickup_at: nextByVehicle.get(vehicle.id) ?? null,
  }));
}

export type PrepTaskDetail = {
  id: string;
  status: PrepStatus;
  checklist: PrepChecklist;
  notes: string | null;
  issue: string | null;
  issue_open: boolean;
  due_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  vehicle: { id: string; fleet_number: string; license_plate: string | null; clean_state: CleanState; battery_level: number | null; vehicle_class: { name: string; name_zh: string | null } | null } | null;
  assignee: { display_name: string } | null;
  photos: Array<{ id: string; phase: "BEFORE" | "AFTER"; url: string }>;
  videos: Array<{ id: string; url: string; duration: number | null }>;
};

export async function getPrepTask(id: string): Promise<PrepTaskDetail | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("prep_tasks")
    .select("id, status, checklist, notes, issue, issue_open, due_at, started_at, completed_at, created_at, vehicle:vehicles(id, fleet_number, license_plate, clean_state, battery_level, vehicle_class:vehicle_classes(name, name_zh)), assignee:staff_members!prep_tasks_assigned_to_fkey(display_name), photos:prep_photos(id, phase, storage_path)")
    .eq("id", id)
    .maybeSingle();
  if (!data) return null;
  const row = data as unknown as Omit<PrepTaskDetail, "photos" | "videos"> & { photos: Array<{ id: string; phase: "BEFORE" | "AFTER"; storage_path: string }> };
  const admin = createAdminClient();
  const urls = new Map<string, string>();
  if (row.photos.length) {
    const { data: signed } = await admin.storage.from(prepPhotoBucket).createSignedUrls(row.photos.map((photo) => photo.storage_path), 600);
    for (const item of signed ?? []) if (item.path && item.signedUrl) urls.set(item.path, item.signedUrl);
  }
  const videos: PrepTaskDetail["videos"] = [];
  if (r2Configured()) {
    const { data: media } = await admin.from("media").select("id, storage_key, duration_seconds").eq("prep_task_id", id).eq("kind", "VIDEO").order("created_at");
    for (const item of media ?? []) {
      const url = await presignDownload(item.storage_key).catch(() => "");
      if (url) videos.push({ id: item.id, url, duration: item.duration_seconds });
    }
  }
  return { ...row, checklist: row.checklist ?? {}, photos: row.photos.map((photo) => ({ id: photo.id, phase: photo.phase, url: urls.get(photo.storage_path) ?? "" })).filter((photo) => photo.url), videos };
}

export async function countPrepAttention() {
  const supabase = createAdminClient();
  const soon = new Date(Date.now() + 2 * 3600000).toISOString();
  const [{ count: overdue }, { count: issues }, { count: open }] = await Promise.all([
    supabase.from("prep_tasks").select("id", { count: "exact", head: true }).neq("status", "DONE").lt("due_at", soon),
    supabase.from("prep_tasks").select("id", { count: "exact", head: true }).eq("issue_open", true),
    supabase.from("prep_tasks").select("id", { count: "exact", head: true }).neq("status", "DONE"),
  ]);
  return { overdue: overdue ?? 0, issues: issues ?? 0, open: open ?? 0 };
}
