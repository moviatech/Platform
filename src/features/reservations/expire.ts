import "server-only";
import { cache } from "react";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export async function expireStaleReservations() {
  try {
    const { data } = await createAdminClient().rpc("expire_stale_reservations");
    return typeof data === "number" ? data : 0;
  } catch {
    return 0;
  }
}

export const expireOnce = cache(() => expireStaleReservations());

export const expireAhead = cache(async () => {
  try {
    const supabase = await createClient();
    const { data } = await supabase.auth.getClaims();
    if (data?.claims.sub) await expireOnce();
  } catch {
    return;
  }
});
