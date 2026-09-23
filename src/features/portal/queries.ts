import "server-only";
import { expireStaleReservations } from "@/features/reservations/expire";
import { createAdminClient } from "@/lib/supabase/admin";
import type { LineItem, ReservationStatus } from "@/features/reservations/types";

export type Trip = {
  id: string;
  number: string;
  status: ReservationStatus;
  pickup_at: string;
  return_at: string;
  rental_days: number;
  rate_plan: "PAY_NOW" | "PAY_LATER";
  pickup_method: "STORE" | "DELIVERY";
  delivery_address: string | null;
  protection: string;
  add_ons: string[];
  payment_state: string;
  verification_state: string;
  agreement_state: string;
  hold_state: string;
  total_cents: number;
  security_hold_cents: number;
  quote_snapshot: { depositCents?: number; averageDailyCents?: number; multiplierBps?: number } | null;
  policy_snapshot: { cancelPolicy?: import("@/features/payments/cancellation").CancelPolicy } | null;
  expires_at: string | null;
  customer_notes: string | null;
  created_at: string;
  assigned_vehicle_id: string | null;
  vehicle_class: { name: string; name_zh: string | null; slug: string; seats: number | null; range_miles: number | null } | null;
  vehicle: { fleet_number: string; exterior_color: string | null; license_plate: string | null } | null;
  location: { name: string; name_zh: string | null; address: string | null; pickup_instructions: string | null; pickup_instructions_zh: string | null } | null;
  line_items: LineItem[];
};

const columns =
  "id, number, status, pickup_at, return_at, rental_days, rate_plan, pickup_method, delivery_address, protection, add_ons, payment_state, verification_state, agreement_state, hold_state, total_cents, security_hold_cents, quote_snapshot, policy_snapshot, expires_at, customer_notes, created_at, assigned_vehicle_id, vehicle_class:vehicle_classes(name, name_zh, slug, seats, range_miles), vehicle:vehicles!reservations_assigned_vehicle_id_fkey(fleet_number, exterior_color, license_plate), location:locations!reservations_pickup_location_id_fkey(name, name_zh, address, pickup_instructions, pickup_instructions_zh), line_items:reservation_line_items(id, type, code, description, quantity, unit_cents, amount_cents, sort_order)";

export async function listTrips(customerId: string): Promise<Trip[]> {
  await expireStaleReservations();
  const supabase = createAdminClient();
  const { data, error } = await supabase.from("reservations").select(columns).eq("customer_id", customerId).order("pickup_at", { ascending: false }).limit(50);
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as Trip[];
}

export async function getTrip(customerId: string, number: string): Promise<Trip | null> {
  const supabase = createAdminClient();
  const { data } = await supabase.from("reservations").select(columns).eq("customer_id", customerId).eq("number", number).maybeSingle();
  if (!data) return null;
  const trip = data as unknown as Trip & { line_items: Array<LineItem & { sort_order: number }> };
  trip.line_items = [...trip.line_items].sort((a, b) => a.sort_order - b.sort_order);
  return trip;
}

export type TripPayment = { id: string; kind: string; status: string; amount_cents: number; amount_captured_cents: number; amount_refunded_cents: number; checkout_url: string | null; created_at: string };

export async function listTripPayments(customerId: string, reservationId: string): Promise<TripPayment[]> {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("payments")
    .select("id, kind, status, amount_cents, amount_captured_cents, amount_refunded_cents, checkout_url, created_at")
    .eq("customer_id", customerId)
    .eq("reservation_id", reservationId)
    .order("created_at");
  return (data ?? []) as TripPayment[];
}
