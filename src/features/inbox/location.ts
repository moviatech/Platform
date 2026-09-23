import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

export async function locationForReservation(reservationId: string | null | undefined): Promise<string | null> {
  if (!reservationId) return null;
  const { data } = await createAdminClient().from("reservations").select("pickup_location_id").eq("id", reservationId).maybeSingle();
  return (data?.pickup_location_id as string | undefined) ?? null;
}

export async function locationForCustomer(customerId: string | null | undefined): Promise<string | null> {
  if (!customerId) return null;
  const admin = createAdminClient();
  const { data: reservation } = await admin.from("reservations").select("pickup_location_id").eq("customer_id", customerId).order("pickup_at", { ascending: false }).limit(1).maybeSingle();
  if (reservation?.pickup_location_id) return reservation.pickup_location_id as string;
  const { data: customer } = await admin.from("customers").select("location_id").eq("id", customerId).maybeSingle();
  return (customer?.location_id as string | null | undefined) ?? null;
}

export async function locationForEmail(email: string | null | undefined): Promise<string | null> {
  if (!email) return null;
  const { data } = await createAdminClient().from("customers").select("id").ilike("email", email).limit(1).maybeSingle();
  return locationForCustomer(data?.id as string | undefined);
}
