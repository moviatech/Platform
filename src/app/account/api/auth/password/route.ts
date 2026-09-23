import { z } from "zod";
import { clientIp, customerPayload, guard, preflight, recentCount, record, reply } from "@/features/portal/auth-api";
import { emailSchema, rememberLanguage } from "@/features/portal/auth-core";
import { createClient } from "@/lib/supabase/server";

const input = z.object({ email: emailSchema, password: z.string().min(1).max(72) });

export async function POST(request: Request) {
  const guarded = await guard(request);
  if ("failed" in guarded) return guarded.failed;
  const parsed = input.safeParse({ email: String(guarded.body.email ?? "").trim().toLowerCase(), password: guarded.body.password });
  if (!parsed.success) return reply({ error: "credentials" }, 401);
  const ip = await clientIp();
  const [byEmail, byIp] = await Promise.all([recentCount("customer.login_failed", 15, { email: parsed.data.email }), recentCount("customer.login_failed", 15, { ip })]);
  if (byEmail >= 5 || byIp >= 30) return reply({ error: "rate_limited" }, 429);
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error || !data.user) {
    await record("customer.login_failed", parsed.data.email, ip);
    return reply({ error: error && /not confirmed/i.test(error.message) ? "unconfirmed" : "credentials" }, 401);
  }
  await rememberLanguage(parsed.data.email);
  return reply({ customer: await customerPayload() });
}

export function OPTIONS() {
  return preflight();
}
