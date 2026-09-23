import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { driverDone, insuranceRequired, maxDrivers, type DriverRow, type DriverStatus } from "./types";

export const driverColumns = "id, reservation_id, position, status, international, full_name, license_last4, license_country, license_expires_on, photo_path, verified_at";

export async function listDrivers(reservationId: string): Promise<DriverRow[]> {
  const { data } = await createAdminClient().from("reservation_drivers").select(driverColumns).eq("reservation_id", reservationId).order("position");
  return (data ?? []) as DriverRow[];
}

export async function refreshDriversPending(reservationId: string) {
  const supabase = createAdminClient();
  const { data } = await supabase.from("reservation_drivers").select("status").eq("reservation_id", reservationId);
  const pending = (data ?? []).filter((row) => !driverDone(row.status as DriverStatus)).length;
  await supabase.from("reservations").update({ drivers_pending: pending }).eq("id", reservationId);
  return pending;
}

export async function syncDriverSlots(reservationId: string, count: number) {
  const supabase = createAdminClient();
  const target = Math.max(0, Math.min(maxDrivers, count));
  const { data } = await supabase.from("reservation_drivers").select("id, position").eq("reservation_id", reservationId);
  const existing = data ?? [];
  const missing = Array.from({ length: target }, (_, index) => index + 1).filter((position) => !existing.some((row) => row.position === position));
  if (missing.length) await supabase.from("reservation_drivers").insert(missing.map((position) => ({ reservation_id: reservationId, position })));
  const extra = existing.filter((row) => row.position > target).map((row) => row.id);
  if (extra.length) await supabase.from("reservation_drivers").delete().in("id", extra);
  await supabase.from("reservations").update({ extra_drivers: target }).eq("id", reservationId);
  await refreshDriversPending(reservationId);
}

export async function syncInsuranceState(reservationId: string, protection: string) {
  const supabase = createAdminClient();
  const { data } = await supabase.from("reservations").select("insurance_state").eq("id", reservationId).maybeSingle();
  const current = data?.insurance_state ?? "NOT_REQUIRED";
  if (!insuranceRequired(protection)) {
    if (current !== "NOT_REQUIRED") await supabase.from("reservations").update({ insurance_state: "NOT_REQUIRED" }).eq("id", reservationId);
    return;
  }
  if (current === "NOT_REQUIRED") await supabase.from("reservations").update({ insurance_state: "PENDING" }).eq("id", reservationId);
}
