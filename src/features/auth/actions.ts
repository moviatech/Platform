"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { isLocale, localeCookie } from "@/i18n/config";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCustomerSession } from "@/lib/auth/customer";
import { audit } from "@/lib/audit";
import { createClient as createPlainClient } from "@supabase/supabase-js";
import { getStaffSession } from "@/lib/auth/staff";
import { clientIp, record, throttled } from "@/lib/auth/throttle";
import { supabasePublishableKey, supabaseUrl } from "@/lib/env";

export type AuthState = { error?: "invalid" | "credentials" | "code" | "unavailable" | "rate_limited" };

const credentials = z.object({
  email: z.email().max(200),
  password: z.string().min(8).max(200),
});

const codeInput = z.object({
  factorId: z.uuid(),
  code: z.string().regex(/^\d{6}$/),
});

export async function signIn(_: AuthState, form: FormData): Promise<AuthState> {
  const parsed = credentials.safeParse({ email: form.get("email"), password: form.get("password") });
  if (!parsed.success) return { error: "invalid" };
  const ip = await clientIp();
  if (await throttled({ action: "staff.login_failed", minutes: 15, ip, perIp: 30, email: parsed.data.email, perEmail: 5 })) return { error: "rate_limited" };

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error || !data.user) {
    await record("staff.login_failed", parsed.data.email, ip, "STAFF");
    return { error: "credentials" };
  }

  const { data: member } = await supabase
    .from("staff_members")
    .select("user_id, active")
    .eq("user_id", data.user.id)
    .maybeSingle();
  if (!member?.active) {
    await supabase.auth.signOut();
    await record("staff.login_failed", parsed.data.email, ip, "STAFF");
    return { error: "credentials" };
  }
  redirect("/");
}

export async function verifyMfa(_: AuthState, form: FormData): Promise<AuthState> {
  const parsed = codeInput.safeParse({ factorId: form.get("factorId"), code: form.get("code") });
  if (!parsed.success) return { error: "code" };

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) redirect("/login");

  const { error } = await supabase.auth.mfa.challengeAndVerify(parsed.data);
  if (error) return { error: "code" };

  await createAdminClient()
    .from("staff_members")
    .update({ last_login_at: new Date().toISOString() })
    .eq("user_id", auth.user.id);
  await audit({
    actorUserId: auth.user.id,
    actorType: "STAFF",
    action: "staff.signed_in",
    entityType: "staff_member",
    entityId: auth.user.id,
  });
  redirect("/");
}

export type EnrollState = { factorId?: string; qr?: string; secret?: string; replaced?: boolean; error?: "unavailable" };

export async function startEnrollment(): Promise<EnrollState> {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) redirect("/login");

  const { data: factors } = await supabase.auth.mfa.listFactors();
  if (factors?.totp.length) redirect("/mfa");
  const stale = (factors?.all ?? []).filter((factor) => factor.status === "unverified");
  for (const factor of stale) await supabase.auth.mfa.unenroll({ factorId: factor.id });

  const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp", friendlyName: `Movia Ops ${Date.now()}` });
  if (error || !data) return { error: "unavailable" };
  return { factorId: data.id, qr: data.totp.qr_code, secret: data.totp.secret, replaced: stale.length > 0 };
}

export type PasswordState = { ok?: boolean; error?: "invalid" | "weak" | "mismatch" | "current" | "same" | "rate_limited" | "failed" };

export async function changeStaffPassword(_: PasswordState, form: FormData): Promise<PasswordState> {
  const session = await getStaffSession();
  const current = String(form.get("current") ?? "");
  const password = String(form.get("password") ?? "");
  if (!current || current.length > 200) return { error: "invalid" };
  if (password.length < 8 || password.length > 72) return { error: "weak" };
  if (password !== String(form.get("confirm") ?? "")) return { error: "mismatch" };
  if (password === current) return { error: "same" };

  const ip = await clientIp();
  if (await throttled({ action: "staff.password_change_failed", minutes: 15, ip, perIp: 20, email: session.email, perEmail: 5 })) return { error: "rate_limited" };
  const probe = createPlainClient(supabaseUrl, supabasePublishableKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error: wrong } = await probe.auth.signInWithPassword({ email: session.email, password: current });
  if (wrong) {
    await record("staff.password_change_failed", session.email, ip, "STAFF");
    return { error: "current" };
  }
  await probe.auth.signOut({ scope: "local" }).catch(() => undefined);

  const { error } = await createAdminClient().auth.admin.updateUserById(session.userId, { password });
  if (error) return { error: "failed" };
  await audit({ actorUserId: session.userId, actorType: "STAFF", action: "staff.password_changed", entityType: "staff", entityId: session.userId, metadata: { by: session.displayName } });
  return { ok: true };
}

export async function setLocale(locale: string) {
  if (!isLocale(locale)) return;
  (await cookies()).set(localeCookie, locale, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
  const customer = await getCustomerSession().catch(() => null);
  if (customer) await createAdminClient().from("customers").update({ preferred_language: locale }).eq("id", customer.customerId);
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
