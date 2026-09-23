import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { chargingHistory, createInvitation, loadTeslaSettings, revokeInvitation, teslaConfigured, vehicleSnapshot } from "@/lib/tesla/client";

export async function teslaReady() {
  if (!teslaConfigured()) return false;
  const stored = await loadTeslaSettings();
  return Boolean(stored.refresh && stored.access);
}

export async function vinForReservation(reservationId: string) {
  const supabase = createAdminClient();
  const { data } = await supabase.from("reservations").select("assigned_vehicle_id, vehicle:vehicles!reservations_assigned_vehicle_id_fkey(vin)").eq("id", reservationId).maybeSingle();
  const row = data as unknown as { vehicle: { vin: string | null } | null } | null;
  return row?.vehicle?.vin ?? null;
}

export async function readForReservation(reservationId: string, options: { wake?: boolean; location?: boolean } = {}) {
  const vin = await vinForReservation(reservationId);
  if (!vin) return null;
  return vehicleSnapshot(vin, { wake: options.wake ?? true, location: options.location ?? false });
}

export async function superchargingFor(reservationId: string) {
  const supabase = createAdminClient();
  const { data } = await supabase.from("reservations").select("pickup_at, actual_pickup_at, vehicle:vehicles!reservations_assigned_vehicle_id_fkey(vin)").eq("id", reservationId).maybeSingle();
  const row = data as unknown as { pickup_at: string; actual_pickup_at: string | null; vehicle: { vin: string | null } | null } | null;
  if (!row?.vehicle?.vin) return null;
  const history = await chargingHistory(row.vehicle.vin, row.actual_pickup_at ?? row.pickup_at, new Date().toISOString());
  return { cents: history.totalCents, sessions: history.sessions.length };
}

export async function inviteForReservation(reservationId: string) {
  const vin = await vinForReservation(reservationId);
  if (!vin) return null;
  const invitation = await createInvitation(vin);
  await createAdminClient().from("reservations").update({ tesla_invitation_id: invitation.id, tesla_share_link: invitation.share_link ?? null }).eq("id", reservationId);
  return invitation.share_link ?? null;
}

export async function revokeForReservation(reservationId: string) {
  const supabase = createAdminClient();
  const { data } = await supabase.from("reservations").select("tesla_invitation_id, vehicle:vehicles!reservations_assigned_vehicle_id_fkey(vin)").eq("id", reservationId).maybeSingle();
  const row = data as unknown as { tesla_invitation_id: string | null; vehicle: { vin: string | null } | null } | null;
  if (!row?.tesla_invitation_id || !row.vehicle?.vin) return false;
  await revokeInvitation(row.vehicle.vin, row.tesla_invitation_id);
  await supabase.from("reservations").update({ tesla_invitation_id: null, tesla_share_link: null }).eq("id", reservationId);
  return true;
}
