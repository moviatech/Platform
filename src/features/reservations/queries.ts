import "server-only";
import { createClient } from "@/lib/supabase/server";
import { expireStaleReservations } from "./expire";
import { openStatuses, reservationStatuses, type ReservationDetail, type ReservationListItem, type ReservationStatus } from "./types";

const listColumns =
  "id, number, status, pickup_at, return_at, rental_days, total_cents, payment_state, booking_source, customer:customers(id, full_name, phone), vehicle_class:vehicle_classes(name, name_zh), vehicle:vehicles!reservations_assigned_vehicle_id_fkey(id, fleet_number)";

export type ReservationFilters = { status?: string; q?: string };

export async function listReservations(filters: ReservationFilters, limit = 100): Promise<ReservationListItem[]> {
  await expireStaleReservations();
  const supabase = await createClient();
  let query = supabase.from("reservations").select(listColumns).limit(limit);

  if ((reservationStatuses as readonly string[]).includes(filters.status ?? "")) {
    query = query.eq("status", filters.status as ReservationStatus).order("pickup_at", { ascending: false });
  } else if (filters.status === "all") {
    query = query.order("pickup_at", { ascending: false });
  } else {
    query = query.in("status", openStatuses).order("pickup_at", { ascending: true });
  }

  const term = (filters.q ?? "").trim().replace(/[%_,()]/g, " ").slice(0, 60);
  if (term) query = query.ilike("number", `%${term}%`);

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as ReservationListItem[];
}

export async function getReservation(id: string): Promise<ReservationDetail | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("reservations")
    .select(
      "id, number, status, class_id, assigned_vehicle_id, pickup_at, return_at, rental_days, rate_plan, pickup_method, delivery_address, protection, add_ons, driver_age_band, payment_state, verification_state, agreement_state, hold_state, subtotal_cents, discount_cents, tax_cents, total_cents, security_hold_cents, quote_snapshot, policy_snapshot, booking_source, expires_at, actual_pickup_at, actual_return_at, customer_notes, internal_notes, cancel_reason, lead_id, created_at, customer:customers(id, full_name, phone, email, wechat, dnr_flag), vehicle_class:vehicle_classes(name, name_zh), vehicle:vehicles!reservations_assigned_vehicle_id_fkey(id, fleet_number), line_items:reservation_line_items(id, type, code, description, quantity, unit_cents, amount_cents, sort_order)",
    )
    .eq("id", id)
    .maybeSingle();
  if (!data) return null;
  const detail = data as unknown as ReservationDetail & { line_items: Array<ReservationDetail["line_items"][number] & { sort_order: number }> };
  detail.line_items = [...(detail.line_items ?? [])].sort((a, b) => a.sort_order - b.sort_order);
  return detail;
}

export type TimelineBar = {
  id: string;
  vehicle_id: string;
  start: string;
  end: string;
  kind: "reservation" | "block";
  label: string;
  status?: ReservationStatus;
  href?: string;
};

export async function listTimeline(from: Date, to: Date): Promise<TimelineBar[]> {
  await expireStaleReservations();
  const supabase = await createClient();
  const [{ data: trips }, { data: blocks }] = await Promise.all([
    supabase
      .from("reservations")
      .select("id, number, status, pickup_at, blocked_until, return_at, assigned_vehicle_id, customer:customers(full_name)")
      .in("status", [...openStatuses, "COMPLETED"])
      .not("assigned_vehicle_id", "is", null)
      .lt("pickup_at", to.toISOString())
      .gt("return_at", from.toISOString()),
    supabase.from("vehicle_blocks").select("id, vehicle_id, starts_at, ends_at, type, reason").lt("starts_at", to.toISOString()).gt("ends_at", from.toISOString()),
  ]);

  const bars: TimelineBar[] = [];
  for (const trip of (trips ?? []) as unknown as Array<{ id: string; number: string; status: ReservationStatus; pickup_at: string; return_at: string; assigned_vehicle_id: string; customer: { full_name: string } | null }>) {
    bars.push({
      id: trip.id,
      vehicle_id: trip.assigned_vehicle_id,
      start: trip.pickup_at,
      end: trip.return_at,
      kind: "reservation",
      status: trip.status,
      label: `${trip.number} · ${trip.customer?.full_name ?? ""}`,
      href: `/reservations/${trip.id}`,
    });
  }
  for (const block of blocks ?? []) {
    bars.push({ id: block.id, vehicle_id: block.vehicle_id, start: block.starts_at, end: block.ends_at, kind: "block", label: block.reason || block.type, href: `/fleet/${block.vehicle_id}` });
  }
  return bars;
}

export async function listTodayMovements(dayStart: Date, dayEnd: Date) {
  const supabase = await createClient();
  const [{ data: pickups }, { data: returns }, { count: requested }] = await Promise.all([
    supabase.from("reservations").select(listColumns).in("status", ["CONFIRMED", "REQUESTED", "PENDING_PAYMENT"]).gte("pickup_at", dayStart.toISOString()).lt("pickup_at", dayEnd.toISOString()).order("pickup_at"),
    supabase.from("reservations").select(listColumns).eq("status", "ACTIVE").lt("return_at", dayEnd.toISOString()).order("return_at"),
    supabase.from("reservations").select("id", { count: "exact", head: true }).eq("status", "REQUESTED"),
  ]);
  return {
    pickups: (pickups ?? []) as unknown as ReservationListItem[],
    returns: (returns ?? []) as unknown as ReservationListItem[],
    requested: requested ?? 0,
  };
}
