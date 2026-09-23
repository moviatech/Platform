import { z } from "zod";
import { clientIp, customerPayload, guard, preflight, recentCount, record, reply } from "@/features/portal/auth-api";
import { emailSchema, rememberLanguage } from "@/features/portal/auth-core";
import { createClient } from "@/lib/supabase/server";

const input = z.object({ email: emailSchema, code: z.string().regex(/^\d{6,10}$/) });

export async function POST(request: Request) {
  const guarded = await guard(request);
  if ("failed" in guarded) return guarded.failed;
  const parsed = input.safeParse({ email: String(guarded.body.email ?? "").trim().toLowerCase(), code: String(guarded.body.code ?? "").trim() });
  if (!parsed.success) return reply({ error: "code" }, 401);
  const ip = await clientIp();
  const [byEmail, byIp] = await Promise.all([recentCount("customer.code_failed", 15, { email: parsed.data.email }), recentCount("customer.code_failed", 15, { ip })]);
  if (byEmail >= 10 || byIp >= 30) return reply({ error: "rate_limited" }, 429);
  const supabase = await createClient();
  const { data, error } = await supabase.auth.verifyOtp({ email: parsed.data.email, token: parsed.data.code, type: "email" });
  if (error || !data.user) {
    await record("customer.code_failed", parsed.data.email, ip);
    return reply({ error: "code" }, 401);
  }
  await rememberLanguage(parsed.data.email);
  return reply({ customer: await customerPayload() });
}

export function OPTIONS() {
  return preflight();
}
