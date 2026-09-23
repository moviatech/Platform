import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

export type SnapshotResult = { table: string; changed: number; deleted: number; error: string | null; skipped: boolean };

export async function runSnapshots(deadline = Number.POSITIVE_INFINITY): Promise<SnapshotResult[]> {
  const supabase = createAdminClient();
  const { data, error } = await supabase.from("fin_snapshot_sources").select("source_table").eq("enabled", true).order("source_table");
  if (error) throw new Error(`finance_snapshot_sources: ${error.message}`);
  const results: SnapshotResult[] = [];
  for (const row of (data ?? []) as Array<{ source_table: string }>) {
    if (Date.now() >= deadline) {
      results.push({ table: row.source_table, changed: 0, deleted: 0, error: null, skipped: true });
      continue;
    }
    const { data: counts, error: failed } = await supabase.rpc("fin_snapshot_source", { p_table: row.source_table });
    const value = (counts ?? {}) as { changed?: number; deleted?: number };
    results.push({ table: row.source_table, changed: value.changed ?? 0, deleted: value.deleted ?? 0, error: failed?.message ?? null, skipped: false });
  }
  return results;
}
