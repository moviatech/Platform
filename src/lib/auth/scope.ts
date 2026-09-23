import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { ForbiddenError, type StaffSession } from "./staff";

export type ScopeTarget = { location?: string | null; vehicle?: string | null; reservation?: string | null; customer?: string | null; conversation?: string | null; prepTask?: string | null; inspection?: string | null; claim?: string | null; payment?: string | null; block?: string | null; media?: string | null; message?: string | null };

export const isScoped = (session: StaffSession) => session.locationIds !== null;

export function allowsLocation(session: StaffSession, locationId: string | null | undefined) {
  if (session.locationIds === null) return true;
  return Boolean(locationId) && session.locationIds.includes(locationId as string);
}

const one = async <T>(query: PromiseLike<{ data: unknown }>) => (await query).data as T | null;

export async function reservationLocations(reservationId: string) {
  return one<{ pickup_location_id: string | null; return_location_id: string | null }>(createAdminClient().from("reservations").select("pickup_location_id, return_location_id").eq("id", reservationId).maybeSingle());
}

export async function customerInScope(session: StaffSession, customerId: string) {
  if (session.locationIds === null) return true;
  const admin = createAdminClient();
  const customer = await one<{ location_id: string | null }>(admin.from("customers").select("location_id").eq("id", customerId).maybeSingle());
  if (!customer) return false;
  if (allowsLocation(session, customer.location_id)) return true;
  const { count } = await admin.from("reservations").select("id", { count: "exact", head: true }).eq("customer_id", customerId).or(`pickup_location_id.in.(${session.locationIds.join(",")}),return_location_id.in.(${session.locationIds.join(",")})`);
  return (count ?? 0) > 0;
}

export async function scopeAllows(session: StaffSession, target: ScopeTarget): Promise<boolean> {
  if (session.locationIds === null) return true;
  const admin = createAdminClient();
  if (target.location !== undefined) return allowsLocation(session, target.location);
  if (target.vehicle) {
    const row = await one<{ location_id: string | null }>(admin.from("vehicles").select("location_id").eq("id", target.vehicle).maybeSingle());
    return Boolean(row) && allowsLocation(session, row?.location_id);
  }
  if (target.reservation) {
    const row = await reservationLocations(target.reservation);
    return Boolean(row) && (allowsLocation(session, row?.pickup_location_id) || allowsLocation(session, row?.return_location_id));
  }
  if (target.customer) return customerInScope(session, target.customer);
  if (target.conversation) {
    const row = await one<{ location_id: string | null }>(admin.from("conversations").select("location_id").eq("id", target.conversation).maybeSingle());
    return Boolean(row) && allowsLocation(session, row?.location_id);
  }
  if (target.message) {
    const row = await one<{ conversation_id: string | null }>(admin.from("messages").select("conversation_id").eq("id", target.message).maybeSingle());
    return Boolean(row?.conversation_id) && scopeAllows(session, { conversation: row?.conversation_id });
  }
  if (target.prepTask) {
    const row = await one<{ vehicle_id: string | null }>(admin.from("prep_tasks").select("vehicle_id").eq("id", target.prepTask).maybeSingle());
    return Boolean(row?.vehicle_id) && scopeAllows(session, { vehicle: row?.vehicle_id });
  }
  if (target.inspection) {
    const row = await one<{ reservation_id: string | null }>(admin.from("inspections").select("reservation_id").eq("id", target.inspection).maybeSingle());
    return Boolean(row?.reservation_id) && scopeAllows(session, { reservation: row?.reservation_id });
  }
  if (target.claim) {
    const row = await one<{ reservation_id: string | null }>(admin.from("damage_claims").select("reservation_id").eq("id", target.claim).maybeSingle());
    return Boolean(row?.reservation_id) && scopeAllows(session, { reservation: row?.reservation_id });
  }
  if (target.payment) {
    const row = await one<{ reservation_id: string | null }>(admin.from("payments").select("reservation_id").eq("id", target.payment).maybeSingle());
    return Boolean(row?.reservation_id) && scopeAllows(session, { reservation: row?.reservation_id });
  }
  if (target.block) {
    const row = await one<{ vehicle_id: string | null }>(admin.from("vehicle_blocks").select("vehicle_id").eq("id", target.block).maybeSingle());
    return Boolean(row?.vehicle_id) && scopeAllows(session, { vehicle: row?.vehicle_id });
  }
  if (target.media) {
    const row = await one<{ reservation_id: string | null; vehicle_id: string | null }>(admin.from("media").select("reservation_id, vehicle_id").eq("id", target.media).maybeSingle());
    if (!row) return false;
    if (row.reservation_id) return scopeAllows(session, { reservation: row.reservation_id });
    if (row.vehicle_id) return scopeAllows(session, { vehicle: row.vehicle_id });
    return false;
  }
  return false;
}

export async function requireScope(session: StaffSession, target: ScopeTarget) {
  if (!(await scopeAllows(session, target))) throw new ForbiddenError("scope");
}

export function scopeFilter<T extends { in: (column: string, values: string[]) => T }>(session: StaffSession, query: T, column: string): T {
  return session.locationIds === null ? query : query.in(column, session.locationIds);
}
