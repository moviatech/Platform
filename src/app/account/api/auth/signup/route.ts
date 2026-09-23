import { z } from "zod";
import { clientIp, guard, preflight, recentCount, record, reply } from "@/features/portal/auth-api";
import { emailSchema, passwordSchema, sendCode } from "@/features/portal/auth-core";
import { createAdminClient } from "@/lib/supabase/admin";

const input = z.object({ email: emailSchema, password: passwordSchema });

export async function POST(request: Request) {
  const guarded = await guard(request);
  if ("failed" in guarded) return guarded.failed;
  const parsed = input.safeParse({ email: String(guarded.body.email ?? "").trim().toLowerCase(), password: guarded.body.password });
  if (!parsed.success) return reply({ error: parsed.error.issues.some((issue) => issue.path[0] === "password") ? "weak" : "invalid" }, 422);
  const ip = await clientIp();
  if ((await recentCount("customer.signup_requested", 10, { ip })) >= 20) return reply({ error: "rate_limited" }, 429);
  await record("customer.signup_requested", parsed.data.email, ip);
  const created = await createAdminClient().auth.admin.createUser({ email: parsed.data.email, password: parsed.data.password, email_confirm: false });
  if (created.error) return reply({ error: /already|exists|registered/i.test(created.error.message) ? "exists" : "failed" }, /already|exists|registered/i.test(created.error.message) ? 409 : 500);
  const failure = await sendCode(parsed.data.email);
  if (failure) return reply({ error: failure.error }, failure.error === "rate_limited" ? 429 : 500);
  return reply({ ok: true });
}

export function OPTIONS() {
  return preflight();
}
