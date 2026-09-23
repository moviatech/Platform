"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { getInvestorAuth, investorColumns, type InvestorRow } from "@/lib/auth/investor";
import { clearMfaCookie, setMfaCookie } from "@/lib/auth/mfa";
import { clientIp, record, throttled } from "@/lib/auth/throttle";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { verifyTurnstile } from "@/lib/turnstile";
import { checkInvestorMfaCode, currentLocale, emailSchema, findAuthUserId, issueInvestorMfaCode, nameSchema, normalizePhone, notifyStaffNewInvestor, passwordSchema, phoneSchema, rememberInvestorLanguage, sendInvestorCode, sendInvestorPasswordEmail } from "./auth-core";

export type InvestorAuthState = {
  ok?: boolean;
  sent?: boolean;
  error?: "invalid" | "rate_limited" | "send_failed" | "code" | "credentials" | "unconfirmed" | "exists" | "phone_exists" | "account_exists" | "mismatch" | "weak" | "session" | "failed" | "captcha";
};

const trimmed = (value: FormDataEntryValue | null) => String(value ?? "").trim();
const lowerEmail = (value: FormDataEntryValue | null) => trimmed(value).toLowerCase();

export async function signInInvestor(_: InvestorAuthState, form: FormData): Promise<InvestorAuthState> {
  const parsed = z.object({ email: emailSchema, password: z.string().min(1).max(72) }).safeParse({ email: lowerEmail(form.get("email")), password: form.get("password") });
  if (!parsed.success) return { error: "credentials" };
  const ip = await clientIp();
  if (await throttled({ action: "investor.login_failed", minutes: 15, ip, perIp: 30, email: parsed.data.email, perEmail: 5 })) return { error: "rate_limited" };
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error || !data.user) {
    await record("investor.login_failed", parsed.data.email, ip, "INVESTOR");
    return { error: error && /not confirmed/i.test(error.message) ? "unconfirmed" : "credentials" };
  }
  await record("investor.signed_in", parsed.data.email, ip, "INVESTOR");
  const { data: investor } = await createAdminClient().from("investors").select("preferred_language").eq("auth_user_id", data.user.id).maybeSingle();
  if (investor) await rememberInvestorLanguage(investor.preferred_language);
  redirect("/");
}

const signupInput = z.object({ legalName: nameSchema, email: emailSchema, phone: phoneSchema, password: passwordSchema, confirm: z.string() });

export async function signUpInvestor(_: InvestorAuthState, form: FormData): Promise<InvestorAuthState> {
  const parsed = signupInput.safeParse({ legalName: trimmed(form.get("legalName")), email: lowerEmail(form.get("email")), phone: trimmed(form.get("phone")), password: form.get("password"), confirm: form.get("confirm") });
  if (!parsed.success) return { error: parsed.error.issues.some((issue) => issue.path[0] === "password") ? "weak" : "invalid" };
  if (parsed.data.password !== parsed.data.confirm) return { error: "mismatch" };
  const ip = await clientIp();
  if (!(await verifyTurnstile(form.get("turnstileToken"), ip))) return { error: "captcha" };
  if (await throttled({ action: "investor.signup_requested", minutes: 10, ip, perIp: 10 })) return { error: "rate_limited" };
  await record("investor.signup_requested", parsed.data.email, ip, "INVESTOR");

  const admin = createAdminClient();
  const [{ data: byEmail }, { data: byPhone }] = await Promise.all([
    admin.from("investors").select("id").ilike("email", parsed.data.email).maybeSingle(),
    admin.from("investors").select("id").eq("phone_normalized", normalizePhone(parsed.data.phone)).maybeSingle(),
  ]);
  if (byEmail) return { error: "exists" };
  if (byPhone) return { error: "phone_exists" };

  const locale = await currentLocale();
  const created = await admin.auth.admin.createUser({
    email: parsed.data.email,
    password: parsed.data.password,
    email_confirm: false,
    user_metadata: { investor_application: { legal_name: parsed.data.legalName, phone: parsed.data.phone, locale, at: new Date().toISOString() } },
  });
  if (created.error || !created.data.user) {
    if (created.error && /already|exists|registered/i.test(created.error.message)) return { error: "account_exists" };
    return { error: "failed" };
  }
  await audit({ actorUserId: created.data.user.id, actorType: "INVESTOR", action: "investor.signup_started", entityType: "auth_user", entityId: created.data.user.id, metadata: { email: parsed.data.email } });
  const failure = await sendInvestorCode(parsed.data.email, locale);
  if (failure) return { error: failure };
  redirect(`/signup/verify?email=${encodeURIComponent(parsed.data.email)}`);
}

export async function resendSignupCode(_: InvestorAuthState, form: FormData): Promise<InvestorAuthState> {
  const parsed = emailSchema.safeParse(lowerEmail(form.get("email")));
  if (!parsed.success) return { error: "invalid" };
  if (!(await findAuthUserId(parsed.data))) return { error: "invalid" };
  const failure = await sendInvestorCode(parsed.data, await currentLocale());
  return failure ? { error: failure } : { sent: true };
}

export async function verifySignupCode(_: InvestorAuthState, form: FormData): Promise<InvestorAuthState> {
  const parsed = z.object({ email: emailSchema, code: z.string().regex(/^\d{6,10}$/) }).safeParse({ email: lowerEmail(form.get("email")), code: trimmed(form.get("code")) });
  if (!parsed.success) return { error: "code" };
  const ip = await clientIp();
  if (await throttled({ action: "investor.code_failed", minutes: 15, ip, perIp: 30, email: parsed.data.email, perEmail: 10 })) return { error: "rate_limited" };
  const supabase = await createClient();
  const { data, error } = await supabase.auth.verifyOtp({ email: parsed.data.email, token: parsed.data.code, type: "email" });
  if (error || !data.user) {
    await record("investor.code_failed", parsed.data.email, ip, "INVESTOR");
    return { error: "code" };
  }
  await record("investor.signed_in", parsed.data.email, ip, "INVESTOR");
  const admin = createAdminClient();
  let { data: investor } = await admin.from("investors").select("id, legal_name, email, phone").eq("auth_user_id", data.user.id).maybeSingle();
  const application = (data.user.user_metadata as { investor_application?: { legal_name?: string; phone?: string; locale?: string } } | null)?.investor_application;
  if (!investor && application?.legal_name && application.phone) {
    const { data: byPhone } = await admin.from("investors").select("id").eq("phone_normalized", normalizePhone(application.phone)).maybeSingle();
    if (byPhone) redirect("/apply");
    const { data: created } = await admin
      .from("investors")
      .insert({ auth_user_id: data.user.id, legal_name: application.legal_name, email: parsed.data.email, phone: application.phone, preferred_language: application.locale === "en" ? "en" : "zh", status: "PENDING" })
      .select("id, legal_name, email, phone")
      .maybeSingle();
    investor = created;
    await admin.auth.admin.updateUserById(data.user.id, { user_metadata: { investor_application: null } }).catch(() => undefined);
    if (investor) {
      await audit({ actorUserId: data.user.id, actorType: "INVESTOR", action: "investor.signed_up", entityType: "investor", entityId: investor.id, metadata: { email: parsed.data.email } });
      await notifyStaffNewInvestor(investor);
    }
  }
  redirect("/pending");
}

export async function applyAsInvestor(_: InvestorAuthState, form: FormData): Promise<InvestorAuthState> {
  const auth = await getInvestorAuth();
  if (!auth) redirect("/login");
  if (auth.investor) redirect("/");
  const parsed = z.object({ legalName: nameSchema, phone: phoneSchema }).safeParse({ legalName: trimmed(form.get("legalName")), phone: trimmed(form.get("phone")) });
  if (!parsed.success) return { error: "invalid" };
  const admin = createAdminClient();
  const { data: byPhone } = await admin.from("investors").select("id").eq("phone_normalized", normalizePhone(parsed.data.phone)).maybeSingle();
  if (byPhone) return { error: "phone_exists" };
  const { data: investor, error } = await admin
    .from("investors")
    .insert({ auth_user_id: auth.userId, legal_name: parsed.data.legalName, email: auth.email, phone: parsed.data.phone, preferred_language: await currentLocale(), status: "PENDING" })
    .select("id, legal_name, email, phone")
    .single();
  if (error || !investor) return { error: /phone/.test(error?.message ?? "") ? "phone_exists" : "failed" };
  await audit({ actorUserId: auth.userId, actorType: "INVESTOR", action: "investor.applied", entityType: "investor", entityId: investor.id, metadata: { email: auth.email } });
  await notifyStaffNewInvestor(investor);
  redirect("/pending");
}

export async function requestInvestorPasswordReset(_: InvestorAuthState, form: FormData): Promise<InvestorAuthState> {
  const parsed = emailSchema.safeParse(lowerEmail(form.get("email")));
  if (!parsed.success) return { error: "invalid" };
  const ip = await clientIp();
  if (await throttled({ action: "investor.password_email_requested", minutes: 10, ip, perIp: 20, email: parsed.data, perEmail: 5 })) return { error: "rate_limited" };
  await record("investor.password_email_requested", parsed.data, ip, "INVESTOR");
  const { data: investor } = await createAdminClient().from("investors").select("id").ilike("email", parsed.data).maybeSingle();
  if (investor) await sendInvestorPasswordEmail(parsed.data, await currentLocale(), "reset");
  redirect("/forgot?sent=1");
}

const passwordInput = z.object({ password: passwordSchema, confirm: z.string() });

export async function resetInvestorPassword(_: InvestorAuthState, form: FormData): Promise<InvestorAuthState> {
  const parsed = passwordInput.safeParse({ password: form.get("password"), confirm: form.get("confirm") });
  if (!parsed.success) return { error: "weak" };
  if (parsed.data.password !== parsed.data.confirm) return { error: "mismatch" };
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { error: "session" };
  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) return { error: "failed" };
  await audit({ actorUserId: auth.user.id, actorType: "INVESTOR", action: "investor.password_reset", entityType: "auth_user", entityId: auth.user.id });
  redirect("/");
}

export async function setInvestorPassword(_: InvestorAuthState, form: FormData): Promise<InvestorAuthState> {
  const parsed = passwordInput.safeParse({ password: form.get("password"), confirm: form.get("confirm") });
  if (!parsed.success) return { error: "weak" };
  if (parsed.data.password !== parsed.data.confirm) return { error: "mismatch" };
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { error: "session" };
  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) return { error: "failed" };
  await audit({ actorUserId: auth.user.id, actorType: "INVESTOR", action: "investor.password_changed", entityType: "auth_user", entityId: auth.user.id });
  return { ok: true };
}

async function activeInvestorForMfa(): Promise<InvestorRow> {
  const auth = await getInvestorAuth();
  if (!auth) redirect("/login");
  if (!auth.investor) redirect("/apply");
  if (auth.investor.status !== "ACTIVE") redirect("/pending");
  if (auth.mfaVerified) redirect("/");
  const { data } = await createAdminClient().from("investors").select(investorColumns).eq("id", auth.investor.id).maybeSingle();
  return (data as InvestorRow | null) ?? auth.investor;
}

export async function sendInvestorMfaCode(): Promise<InvestorAuthState> {
  const investor = await activeInvestorForMfa();
  const failure = await issueInvestorMfaCode(investor);
  return failure ? { error: failure } : { sent: true };
}

export async function verifyInvestorMfaCode(_: InvestorAuthState, form: FormData): Promise<InvestorAuthState> {
  const investor = await activeInvestorForMfa();
  const code = z.string().trim().regex(/^\d{6}$/).safeParse(form.get("code"));
  if (!code.success) return { error: "invalid", sent: true };
  const ip = await clientIp();
  if (await throttled({ action: "investor.mfa_failed", minutes: 15, ip, perIp: 30, email: investor.email, perEmail: 10 })) return { error: "rate_limited", sent: true };
  if (!(await checkInvestorMfaCode(investor.id, code.data))) {
    await record("investor.mfa_failed", investor.email, ip, "INVESTOR");
    return { error: "code", sent: true };
  }
  await setMfaCookie(investor.auth_user_id ?? "");
  await record("investor.mfa_verified", investor.email, ip, "INVESTOR");
  redirect("/");
}

export async function signOutInvestor() {
  await clearMfaCookie();
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
