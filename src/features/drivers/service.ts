import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { driverDone, insuranceRequired, maxDrivers, nextInsuranceState, planDriverSlots, type DriverRow, type DriverStatus, type LicenseKind } from "./types";

export const driverColumns = "id, reservation_id, position, status, international, spouse, full_name, license_last4, license_country, license_expires_on, photo_path, verified_at";

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

export async function syncDriverSlots(reservationId: string, count: number, spouse = false) {
  const supabase = createAdminClient();
  const target = Math.max(0, Math.min(maxDrivers, count));
  const { data } = await supabase.from("reservation_drivers").select("id, position, spouse").eq("reservation_id", reservationId).order("position");
  const existing = (data ?? []) as Array<{ id: string; position: number; spouse: boolean }>;
  const withSpouse = spouse && target > 0;
  const plan = planDriverSlots(existing, target, withSpouse);
  if (plan.remove.length) await supabase.from("reservation_drivers").delete().in("id", plan.remove);
  for (const move of plan.moves) await supabase.from("reservation_drivers").update({ position: move.position }).eq("id", move.id);
  if (plan.create.length) await supabase.from("reservation_drivers").insert(plan.create.map((position) => ({ reservation_id: reservationId, position })));
  await supabase.from("reservation_drivers").update({ spouse: false }).eq("reservation_id", reservationId).eq("spouse", true).neq("position", plan.spousePosition ?? 0);
  if (plan.spousePosition) await supabase.from("reservation_drivers").update({ spouse: true }).eq("reservation_id", reservationId).eq("position", plan.spousePosition);
  await supabase.from("reservations").update({ extra_drivers: target, spouse_driver: withSpouse }).eq("id", reservationId);
  await refreshDriversPending(reservationId);
}

type InsuranceRow = { id: string; insurance_state: string; insurance_proof_path: string | null };

async function applyInsuranceState(row: InsuranceRow, required: boolean) {
  const next = nextInsuranceState(row.insurance_state, required, Boolean(row.insurance_proof_path));
  if (next === row.insurance_state) return;
  await createAdminClient()
    .from("reservations")
    .update({ insurance_state: next, ...(row.insurance_state === "VERIFIED" ? { insurance_verified_by: null, insurance_verified_at: null } : {}) })
    .eq("id", row.id);
}

const beforePickup = ["REQUESTED", "PENDING_PAYMENT", "CONFIRMED"];

export async function syncInsuranceState(reservationId: string, protection?: string) {
  const { data } = await createAdminClient().from("reservations").select("id, status, protection, insurance_state, insurance_proof_path, customer:customers(license_kind)").eq("id", reservationId).maybeSingle();
  const row = data as unknown as (InsuranceRow & { status: string; protection: string; customer: { license_kind: string | null } | null }) | null;
  if (!row || !beforePickup.includes(row.status)) return;
  await applyInsuranceState(row, insuranceRequired(protection ?? row.protection, row.customer?.license_kind));
}

export async function syncCustomerInsurance(customerId: string) {
  const supabase = createAdminClient();
  const [{ data: customer }, { data: rows }] = await Promise.all([
    supabase.from("customers").select("license_kind").eq("id", customerId).maybeSingle(),
    supabase.from("reservations").select("id, protection, insurance_state, insurance_proof_path").eq("customer_id", customerId).in("status", beforePickup),
  ]);
  for (const row of rows ?? []) await applyInsuranceState(row, insuranceRequired(row.protection, customer?.license_kind));
}

export async function confirmLicenseKind(customerId: string, kind: LicenseKind) {
  const { error } = await createAdminClient().from("customers").update({ license_kind: kind, license_kind_confirmed: true }).eq("id", customerId);
  if (error) return false;
  await syncCustomerInsurance(customerId);
  return true;
}
