import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

export async function expireStaleReservations() {
  try {
    await createAdminClient().rpc("expire_stale_reservations");
  } catch {
    return;
  }
}
