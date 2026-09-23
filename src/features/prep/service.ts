import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

export async function nextPickupFor(vehicleId: string) {
  const { data } = await createAdminClient()
    .from("reservations")
    .select("pickup_at")
    .eq("assigned_vehicle_id", vehicleId)
    .in("status", ["CONFIRMED", "REQUESTED", "PENDING_PAYMENT"])
    .gt("pickup_at", new Date().toISOString())
    .order("pickup_at")
    .limit(1)
    .maybeSingle();
  return data?.pickup_at ?? null;
}

export async function openPrepTask(vehicleId: string, reservationId: string | null, createdBy: string | null) {
  const supabase = createAdminClient();
  const { data: existing } = await supabase.from("prep_tasks").select("id").eq("vehicle_id", vehicleId).neq("status", "DONE").limit(1).maybeSingle();
  if (existing) return existing.id as string;
  const { data } = await supabase
    .from("prep_tasks")
    .insert({ vehicle_id: vehicleId, reservation_id: reservationId, due_at: await nextPickupFor(vehicleId), created_by: createdBy })
    .select("id")
    .single();
  return (data?.id as string | undefined) ?? null;
}
