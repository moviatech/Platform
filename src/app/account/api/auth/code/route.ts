import { clientIp, guard, preflight, recentCount, record, reply } from "@/features/portal/auth-api";
import { emailSchema, ensureUser, sendCode } from "@/features/portal/auth-core";

export async function POST(request: Request) {
  const guarded = await guard(request);
  if ("failed" in guarded) return guarded.failed;
  const parsed = emailSchema.safeParse(String(guarded.body.email ?? "").trim().toLowerCase());
  if (!parsed.success) return reply({ error: "invalid" }, 422);
  const ip = await clientIp();
  if ((await recentCount("customer.login_code_requested", 10, { ip })) >= 20) return reply({ error: "rate_limited" }, 429);
  await record("customer.login_code_requested", parsed.data, ip);
  if (!(await ensureUser(parsed.data))) return reply({ error: "send_failed" }, 500);
  const failure = await sendCode(parsed.data);
  if (failure) return reply({ error: failure.error }, failure.error === "rate_limited" ? 429 : 500);
  return reply({ ok: true });
}

export function OPTIONS() {
  return preflight();
}
