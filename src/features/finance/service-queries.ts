import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { readAll } from "./paging";
import { unbookedLogs, type ServiceCar } from "./service-due";

export type ServiceLogRow = { id: string; vehicle_id: string; kind: string; performed_on: string; cost_cents: number; vendor: string | null; notes: string | null; vehicle: ServiceCar };

const columns = "id, vehicle_id, kind, performed_on, cost_cents, vendor, notes, vehicle:vehicles(fleet_number, is_placeholder, vehicle_class:vehicle_classes(slug))";

async function bookedAndSkipped() {
  const supabase = createAdminClient();
  const [booked, skipped] = await Promise.all([
    readAll<{ service_log_id: string }>((from, to) => supabase.from("expenses").select("service_log_id").not("service_log_id", "is", null).is("voided_at", null).order("id").range(from, to), { strict: true }),
    readAll<{ service_log_id: string }>((from, to) => supabase.from("fin_service_log_skips").select("service_log_id").order("service_log_id").range(from, to), { strict: true }),
  ]);
  return { booked: new Set(booked.map((row) => row.service_log_id)), skipped: new Set(skipped.map((row) => row.service_log_id)) };
}

export async function loadServiceDue(): Promise<ServiceLogRow[]> {
  const supabase = createAdminClient();
  const [logs, marks] = await Promise.all([
    readAll<ServiceLogRow>((from, to) => supabase.from("vehicle_service_logs").select(columns).gt("cost_cents", 0).order("performed_on").order("id").range(from, to), { strict: true }),
    bookedAndSkipped(),
  ]);
  return unbookedLogs(logs, marks.booked, marks.skipped);
}

export async function loadServiceLog(id: string): Promise<ServiceLogRow | null> {
  const supabase = createAdminClient();
  const [{ data }, marks] = await Promise.all([supabase.from("vehicle_service_logs").select(columns).eq("id", id).maybeSingle(), bookedAndSkipped()]);
  const row = (data as ServiceLogRow | null) ?? null;
  return row && !marks.booked.has(row.id) && !marks.skipped.has(row.id) ? row : null;
}

export async function serviceMarks() {
  return bookedAndSkipped();
}
