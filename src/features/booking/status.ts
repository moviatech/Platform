import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

export async function isAcceptingBookings() {
  const { data } = await createAdminClient().from("settings").select("value").eq("key", "business").maybeSingle();
  const value = (data?.value ?? null) as Record<string, unknown> | null;
  return value?.acceptingBookings === true;
}

export async function setAcceptingBookings(on: boolean, userId: string | null) {
  const supabase = createAdminClient();
  const { data } = await supabase.from("settings").select("value").eq("key", "business").maybeSingle();
  const value = { ...(((data?.value ?? null) as Record<string, unknown> | null) ?? {}), acceptingBookings: on };
  await supabase.from("settings").upsert({ key: "business", value, updated_by: userId, updated_at: new Date().toISOString() });
}
