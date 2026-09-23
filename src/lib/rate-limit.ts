import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

export type RateLimitResult = { allowed: boolean; count: number; retryAfterSeconds: number };

export async function hitRateLimit(key: string, limit: number, windowSeconds: number): Promise<RateLimitResult> {
  const { data, error } = await createAdminClient().rpc("rate_limit_hit", { p_key: key, p_limit: limit, p_window_seconds: windowSeconds });
  const row = (data as Array<{ allowed: boolean; count: number; retry_after_seconds: number }> | null)?.[0];
  if (error || !row) throw new Error(error?.message ?? "rate_limit_unavailable");
  return { allowed: row.allowed, count: row.count, retryAfterSeconds: row.retry_after_seconds };
}
