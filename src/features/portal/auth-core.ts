import "server-only";
import { cookies } from "next/headers";
import { z } from "zod";
import { isLocale, localeCookie } from "@/i18n/config";
import { withNext } from "@/lib/auth/next-url";
import { sendEmail } from "@/lib/email";
import { renderEmail } from "@/lib/email/template";
import { portalOrigin } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";

export const emailSchema = z.email().max(200);
export const passwordSchema = z.string().min(8).max(72);

export type AuthFailure = "invalid" | "rate_limited" | "send_failed" | "code" | "credentials" | "unconfirmed" | "exists" | "mismatch" | "weak" | "session" | "failed";

export async function currentLocale() {
  const stored = (await cookies()).get(localeCookie)?.value;
  return isLocale(stored) ? stored : "zh";
}

export async function rememberLanguage(address: string) {
  const { data: customer } = await createAdminClient().from("customers").select("preferred_language").eq("email", address).maybeSingle();
  if (customer?.preferred_language && isLocale(customer.preferred_language)) {
    (await cookies()).set(localeCookie, customer.preferred_language, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
  }
}

export async function ensureUser(address: string) {
  const created = await createAdminClient().auth.admin.createUser({ email: address, email_confirm: true });
  return !created.error || /already|exists|registered/i.test(created.error.message);
}

export async function sendCode(address: string, next = "/"): Promise<{ error: AuthFailure } | null> {
  const admin = createAdminClient();
  const since = new Date(Date.now() - 10 * 60000).toISOString();
  const { count } = await admin.from("audit_events").select("id", { count: "exact", head: true }).eq("action", "customer.login_code_sent").contains("metadata", { email: address }).gte("created_at", since);
  if ((count ?? 0) >= 5) return { error: "rate_limited" };

  const link = await admin.auth.admin.generateLink({ type: "magiclink", email: address, options: { redirectTo: `${portalOrigin}/` } });
  const code = link.data?.properties?.email_otp;
  const tokenHash = link.data?.properties?.hashed_token;
  if (link.error || !code || !tokenHash) return { error: "send_failed" };

  const zh = (await currentLocale()) === "zh";
  const confirmUrl = withNext(`${portalOrigin}/auth/confirm?token_hash=${encodeURIComponent(tokenHash)}&type=magiclink`, next);
  const rendered = renderEmail({
    preheader: zh ? `验证码 ${code}` : `Your code is ${code}`,
    title: zh ? "登录" : "Sign in",
    blocks: [
      { type: "paragraph", text: zh ? "输入验证码，或点击按钮直接登录。1 小时内有效。" : "Enter this code, or use the button to sign in. Valid for one hour." },
      { type: "code", text: code },
      { type: "button", label: zh ? "登录" : "Sign in", href: confirmUrl },
      { type: "paragraph", text: zh ? "不是你本人操作的话，忽略即可。" : "If this wasn't you, ignore this email." },
    ],
  });
  const sent = await sendEmail({ to: address, subject: zh ? `Movia 验证码：${code}` : `Movia code: ${code}`, text: rendered.text, html: rendered.html });
  if (!sent.sent) return { error: "send_failed" };
  await admin.from("audit_events").insert({ actor_type: "CUSTOMER", action: "customer.login_code_sent", entity_type: "customer_email", entity_id: address, metadata: { email: address } });
  return null;
}
