import "server-only";
import { deleteObject, r2Configured } from "@/lib/media/r2";
import { createAdminClient } from "@/lib/supabase/admin";

export async function purgeExpiredMedia(limit = 50) {
  if (!r2Configured()) return { purged: 0 };
  const supabase = createAdminClient();
  const { data } = await supabase.from("media").select("id, storage_key").lt("expires_at", new Date().toISOString()).limit(limit);
  let purged = 0;
  for (const row of data ?? []) {
    try {
      await deleteObject(row.storage_key);
      await supabase.from("media").delete().eq("id", row.id);
      purged += 1;
    } catch {
      continue;
    }
  }
  return { purged };
}
