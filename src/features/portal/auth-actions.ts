"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { isLocale, localeCookie } from "@/i18n/config";
import { sendEmail } from "@/lib/email";
import { renderEmail } from "@/lib/email/template";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { nextCookie, safeNext, withNext } from "@/lib/auth/next-url";
import { clientIp, recentCount, record, throttled } from "@/lib/auth/throttle";
import { portalOrigin } from "@/lib/env";
import { currentLocale, emailSchema as email, ensureUser, passwordSchema as password, rememberLanguage, sendCode } from "./auth-core";

export type PortalAuthState = { ok?: boolean; error?: "invalid" | "rate_limited" | "send_failed" | "code" | "credentials" | "unconfirmed" | "exists" | "mismatch" | "weak" | "session" | "failed" };

export async function requestLoginCode(_: PortalAuthState, form: FormData): Promise<PortalAuthState> {
  const parsed = email.safeParse(String(form.get("email") ?? "").trim().toLowerCase());
  if (!parsed.success) return { error: "invalid" };
  const next = safeNext(form.get("next"));
  const ip = await clientIp();
  if (await throttled({ action: "customer.login_code_requested", minutes: 10, ip, perIp: 20 })) return { error: "rate_limited" };
  await record("customer.login_code_requested", parsed.data, ip);
  if (!(await ensureUser(parsed.data))) return { error: "send_failed" };
  const failure = await sendCode(parsed.data, next);
  if (failure) return failure;
  redirect(withNext(`/login/verify?email=${encodeURIComponent(parsed.data)}`, next));
}

export async function verifyLoginCode(_: PortalAuthState, form: FormData): Promise<PortalAuthState> {
  const parsed = z.object({ email, code: z.string().regex(/^\d{6,10}$/) }).safeParse({ email: String(form.get("email") ?? "").trim().toLowerCase(), code: String(form.get("code") ?? "").trim() });
  if (!parsed.success) return { error: "code" };
  const ip = await clientIp();
  if (await throttled({ action: "customer.code_failed", minutes: 15, ip, perIp: 30, email: parsed.data.email, perEmail: 10 })) return { error: "rate_limited" };
  const supabase = await createClient();
  const { data, error } = await supabase.auth.verifyOtp({ email: parsed.data.email, token: parsed.data.code, type: "email" });
  if (error || !data.user) {
    await record("customer.code_failed", parsed.data.email, ip);
    return { error: "code" };
  }
  await rememberLanguage(parsed.data.email);
  redirect(safeNext(form.get("next")));
}

export async function signInWithPassword(_: PortalAuthState, form: FormData): Promise<PortalAuthState> {
  const parsed = z.object({ email, password: z.string().min(1).max(72) }).safeParse({ email: String(form.get("email") ?? "").trim().toLowerCase(), password: form.get("password") });
  if (!parsed.success) return { error: "credentials" };
  const ip = await clientIp();
  if (await throttled({ action: "customer.login_failed", minutes: 15, ip, perIp: 30, email: parsed.data.email, perEmail: 5 })) return { error: "rate_limited" };
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error || !data.user) {
    await record("customer.login_failed", parsed.data.email, ip);
    return { error: error && /not confirmed/i.test(error.message) ? "unconfirmed" : "credentials" };
  }
  await rememberLanguage(parsed.data.email);
  redirect(safeNext(form.get("next")));
}

export async function signUp(_: PortalAuthState, form: FormData): Promise<PortalAuthState> {
  const parsed = z.object({ email, password, confirm: z.string() }).safeParse({ email: String(form.get("email") ?? "").trim().toLowerCase(), password: form.get("password"), confirm: form.get("confirm") });
  if (!parsed.success) return { error: parsed.error.issues.some((issue) => issue.path[0] === "password") ? "weak" : "invalid" };
  if (parsed.data.password !== parsed.data.confirm) return { error: "mismatch" };
  const next = safeNext(form.get("next"));
  const ip = await clientIp();
  if (await throttled({ action: "customer.signup_requested", minutes: 10, ip, perIp: 20 })) return { error: "rate_limited" };
  await record("customer.signup_requested", parsed.data.email, ip);

  const admin = createAdminClient();
  const created = await admin.auth.admin.createUser({ email: parsed.data.email, password: parsed.data.password, email_confirm: false });
  if (created.error) {
    if (!/already|exists|registered/i.test(created.error.message)) return { error: "failed" };
    await sendPasswordEmail(parsed.data.email);
    return { error: "exists" };
  }

  const failure = await sendCode(parsed.data.email, next);
  if (failure) return failure;
  redirect(withNext(`/login/verify?email=${encodeURIComponent(parsed.data.email)}`, next));
}

async function sendPasswordEmail(address: string) {
  if ((await recentCount("customer.password_email_sent", 10, { email: address })) >= 5) return;
  const admin = createAdminClient();
  const link = await admin.auth.admin.generateLink({ type: "recovery", email: address, options: { redirectTo: `${portalOrigin}/reset-password` } });
  const tokenHash = link.data?.properties?.hashed_token;
  if (link.error || !tokenHash) return;
  const zh = (await currentLocale()) === "zh";
  const url = `${portalOrigin}/auth/confirm?token_hash=${encodeURIComponent(tokenHash)}&type=recovery`;
  const rendered = renderEmail({
    title: zh ? "设置密码" : "Set your password",
    blocks: [
      { type: "paragraph", text: zh ? "点击按钮设置新密码。链接 1 小时内有效。" : "Use the button to set a new password. The link is valid for one hour." },
      { type: "button", label: zh ? "设置密码" : "Set password", href: url },
      { type: "paragraph", text: zh ? "不是你本人操作的话，忽略即可。" : "If this wasn't you, ignore this email." },
    ],
  });
  await sendEmail({ to: address, subject: zh ? "Movia 设置密码" : "Movia password", text: rendered.text, html: rendered.html });
  await record("customer.password_email_sent", address, await clientIp());
}

export async function requestPasswordReset(_: PortalAuthState, form: FormData): Promise<PortalAuthState> {
  const parsed = email.safeParse(String(form.get("email") ?? "").trim().toLowerCase());
  if (!parsed.success) return { error: "invalid" };
  const ip = await clientIp();
  if (await throttled({ action: "customer.password_email_requested", minutes: 10, ip, perIp: 20 })) return { error: "rate_limited" };
  await record("customer.password_email_requested", parsed.data, ip);
  await sendPasswordEmail(parsed.data);
  redirect("/forgot?sent=1");
}

export async function setPassword(_: PortalAuthState, form: FormData): Promise<PortalAuthState> {
  const parsed = z.object({ password, confirm: z.string() }).safeParse({ password: form.get("password"), confirm: form.get("confirm") });
  if (!parsed.success) return { error: "weak" };
  if (parsed.data.password !== parsed.data.confirm) return { error: "mismatch" };
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { error: "session" };
  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) return { error: "failed" };
  return { ok: true };
}

export async function resetPassword(_: PortalAuthState, form: FormData): Promise<PortalAuthState> {
  const parsed = z.object({ password, confirm: z.string() }).safeParse({ password: form.get("password"), confirm: form.get("confirm") });
  if (!parsed.success) return { error: "weak" };
  if (parsed.data.password !== parsed.data.confirm) return { error: "mismatch" };
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { error: "session" };
  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) return { error: "failed" };
  redirect("/");
}

export async function startGoogle(form: FormData) {
  const next = safeNext(form.get("next"));
  if (next !== "/") (await cookies()).set(nextCookie, next, { path: "/", maxAge: 600, sameSite: "lax", httpOnly: true });
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo: `${portalOrigin}/auth/callback` } });
  if (error || !data.url) redirect("/login?error=google");
  redirect(data.url);
}

export async function setLocale(locale: string) {
  if (!isLocale(locale)) return;
  (await cookies()).set(localeCookie, locale, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
}

export async function signOutCustomer() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
