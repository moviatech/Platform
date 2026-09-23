import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

export type Cached<Value> = { value: Value; fetchedAt: string; stale: boolean };

export const reportMaxAge = 3600;

export async function cached<Value>(key: string, load: () => Promise<Value>, maxAgeSeconds = reportMaxAge): Promise<Cached<Value>> {
  const supabase = createAdminClient();
  const { data: row } = await supabase.from("marketing_report_cache").select("payload, fetched_at").eq("key", key).maybeSingle();
  if (row && Date.now() - new Date(row.fetched_at as string).getTime() < maxAgeSeconds * 1000) return { value: row.payload as Value, fetchedAt: row.fetched_at as string, stale: false };
  try {
    const value = await load();
    const fetchedAt = new Date().toISOString();
    await supabase.from("marketing_report_cache").upsert({ key, payload: value, fetched_at: fetchedAt });
    return { value, fetchedAt, stale: false };
  } catch (cause) {
    if (row) return { value: row.payload as Value, fetchedAt: row.fetched_at as string, stale: true };
    throw cause;
  }
}

export async function dropCached(prefix: string) {
  if (!/^[a-z0-9:.\/-]{3,120}$/.test(prefix)) return;
  await createAdminClient().from("marketing_report_cache").delete().like("key", `${prefix}%`);
}
