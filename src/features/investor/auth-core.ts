import "server-only";
import { createHash, randomInt } from "node:crypto";
import { cookies } from "next/headers";
import { z } from "zod";
import { notifyStaff } from "@/features/notifications/center";
import { isLocale, localeCookie } from "@/i18n/config";
import { clientIp, record, throttled } from "@/lib/auth/throttle";
import { sendEmail } from "@/lib/email";
import { renderEmail } from "@/lib/email/template";
import { investorOrigin, opsOrigin } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";

export const emailSchema = z.email().max(200);
export const passwordSchema = z.string().min(8).max(72);
export const nameSchema = z.string().trim().min(2).max(120);
export const phoneSchema = z
  .string()
  .trim()
  .max(40)
  .refine((value) => value.replace(/\D/g, "").length >= 7);

export const normalizePhone = (value: string) => value.replace(/\D/g, "");

export type InvestorLocale = "zh" | "en";

export async function currentLocale(): Promise<InvestorLocale> {
  const stored = (await cookies()).get(localeCookie)?.value;
  return isLocale(stored) ? stored : "zh";
}

export async function rememberInvestorLanguage(language: string) {
  if (!isLocale(language)) return;
  (await cookies()).set(localeCookie, language, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
}

export async function findAuthUserId(email: string) {
  const admin = createAdminClient();
  const { data: customer } = await admin.from("customers").select("auth_user_id").ilike("email", email).not("auth_user_id", "is", null).maybeSingle();
  if (customer?.auth_user_id) return customer.auth_user_id as string;
  const { data: staff } = await admin.from("staff_members").select("user_id").ilike("email", email).maybeSingle();
  if (staff?.user_id) return staff.user_id as string;
  const { data: users } = await admin.auth.admin.listUsers({ perPage: 1000 });
  return users?.users.find((user) => user.email?.toLowerCase() === email)?.id ?? null;
}

export async function sendInvestorCode(address: string, locale: InvestorLocale): Promise<"rate_limited" | "send_failed" | null> {
  const admin = createAdminClient();
  const ip = await clientIp();
  if (await throttled({ action: "investor.login_code_sent", minutes: 10, ip, perIp: 20, email: address, perEmail: 5 })) return "rate_limited";
  const link = await admin.auth.admin.generateLink({ type: "magiclink", email: address, options: { redirectTo: `${investorOrigin}/` } });
  const code = link.data?.properties?.email_otp;
  const tokenHash = link.data?.properties?.hashed_token;
  if (link.error || !code || !tokenHash) return "send_failed";
  const zh = locale === "zh";
  const confirmUrl = `${investorOrigin}/auth/confirm?token_hash=${encodeURIComponent(tokenHash)}&type=magiclink`;
  const rendered = renderEmail({
    preheader: zh ? `验证码 ${code}` : `Your code is ${code}`,
    title: zh ? "验证邮箱" : "Verify your email",
    blocks: [
      { type: "paragraph", text: zh ? "输入验证码完成邮箱验证，或点击按钮直接继续。1 小时内有效。" : "Enter this code to verify your email, or use the button to continue. Valid for one hour." },
      { type: "code", text: code },
      { type: "button", label: zh ? "继续" : "Continue", href: confirmUrl },
      { type: "paragraph", text: zh ? "不是你本人操作的话，忽略即可。" : "If this wasn't you, ignore this email." },
    ],
  });
  const sent = await sendEmail({ to: address, subject: zh ? `Movia 投资人验证码：${code}` : `Movia Investor code: ${code}`, text: rendered.text, html: rendered.html });
  if (!sent.sent) return "send_failed";
  await record("investor.login_code_sent", address, ip, "INVESTOR");
  return null;
}

export async function sendInvestorPasswordEmail(address: string, locale: InvestorLocale, variant: "reset" | "welcome") {
  const admin = createAdminClient();
  const link = await admin.auth.admin.generateLink({ type: "recovery", email: address, options: { redirectTo: `${investorOrigin}/reset-password` } });
  const tokenHash = link.data?.properties?.hashed_token;
  if (link.error || !tokenHash) return false;
  const zh = locale === "zh";
  const url = `${investorOrigin}/auth/confirm?token_hash=${encodeURIComponent(tokenHash)}&type=recovery`;
  const welcome = variant === "welcome";
  const rendered = renderEmail({
    title: welcome ? (zh ? "投资人账户已开通" : "Your investor account is ready") : zh ? "重置密码" : "Reset your password",
    blocks: [
      ...(welcome ? [{ type: "paragraph" as const, text: zh ? "Movia 已为你开通投资人账户。点击按钮设置密码后即可登录。" : "Movia has set up your investor account. Use the button to set a password and sign in." }] : []),
      { type: "paragraph", text: zh ? "链接 1 小时内有效。" : "The link is valid for one hour." },
      { type: "button", label: zh ? "设置密码" : "Set password", href: url },
      { type: "paragraph", text: zh ? "不是你本人操作的话，忽略即可。" : "If this wasn't you, ignore this email." },
    ],
  });
  const sent = await sendEmail({ to: address, subject: welcome ? (zh ? "Movia 投资人账户已开通" : "Your Movia investor account") : zh ? "Movia 重置密码" : "Movia password reset", text: rendered.text, html: rendered.html });
  return sent.sent;
}

export async function sendInvestorWelcomeLinked(address: string, locale: InvestorLocale) {
  const zh = locale === "zh";
  const rendered = renderEmail({
    title: zh ? "投资人账户已开通" : "Your investor account is ready",
    blocks: [
      { type: "paragraph", text: zh ? "Movia 已为你开通投资人账户。你的邮箱已有 Movia 登录身份，直接用原密码登录即可。" : "Movia has set up your investor account. Your email already has a Movia login, so sign in with your existing password." },
      { type: "button", label: zh ? "登录" : "Sign in", href: `${investorOrigin}/login` },
    ],
  });
  await sendEmail({ to: address, subject: zh ? "Movia 投资人账户已开通" : "Your Movia investor account", text: rendered.text, html: rendered.html });
}

const codeTtlMs = 10 * 60 * 1000;
const hashCode = (code: string) => createHash("sha256").update(`${process.env.SUPABASE_SECRET_KEY ?? "movia"}:investor:${code}`).digest("hex");

export async function issueInvestorMfaCode(investor: { id: string; email: string; preferred_language: string }): Promise<"rate_limited" | "send_failed" | null> {
  const ip = await clientIp();
  if (await throttled({ action: "investor.mfa_sent", minutes: 15, ip, perIp: 10, email: investor.email, perEmail: 5 })) return "rate_limited";
  const code = String(randomInt(0, 1000000)).padStart(6, "0");
  await createAdminClient().from("investors").update({ mfa_code_hash: hashCode(code), mfa_code_expires_at: new Date(Date.now() + codeTtlMs).toISOString() }).eq("id", investor.id);
  const zh = investor.preferred_language !== "en";
  const rendered = renderEmail({
    preheader: zh ? `验证码 ${code}` : `Your code is ${code}`,
    title: zh ? "两步验证" : "Two-step verification",
    blocks: [
      { type: "paragraph", text: zh ? "输入这个验证码完成验证。10 分钟内有效。" : "Enter this code to finish verifying. Valid for 10 minutes." },
      { type: "code", text: code },
      { type: "paragraph", text: zh ? "不是你本人操作的话，请立即修改密码并联系我们。" : "If this wasn't you, change your password right away and contact us." },
    ],
  });
  const sent = await sendEmail({ to: investor.email, subject: zh ? `Movia 验证码：${code}` : `Movia code: ${code}`, text: rendered.text, html: rendered.html });
  if (!sent.sent) return "send_failed";
  await record("investor.mfa_sent", investor.email, ip, "INVESTOR");
  return null;
}

export async function checkInvestorMfaCode(investorId: string, code: string) {
  const supabase = createAdminClient();
  const { data } = await supabase.from("investors").select("mfa_code_hash, mfa_code_expires_at").eq("id", investorId).maybeSingle();
  if (!data?.mfa_code_hash || !data.mfa_code_expires_at || Date.parse(data.mfa_code_expires_at) < Date.now()) return false;
  if (data.mfa_code_hash !== hashCode(code)) return false;
  await supabase.from("investors").update({ mfa_code_hash: null, mfa_code_expires_at: null }).eq("id", investorId);
  return true;
}

export async function notifyStaffNewInvestor(investor: { id: string; legal_name: string; email: string; phone: string }) {
  await notifyStaff({ kind: "investor_signup", params: { name: investor.legal_name, email: investor.email }, href: `/investors/${investor.id}`, dedupeKey: `investor_signup:${investor.id}` });
  const to = process.env.NOTIFY_EMAIL;
  if (!to) return;
  const rendered = renderEmail({
    title: "新的投资人申请",
    blocks: [
      { type: "rows", rows: [["姓名", investor.legal_name], ["邮箱", investor.email], ["电话", investor.phone]] },
      { type: "button", label: "去审核", href: `${opsOrigin}/investors/${investor.id}` },
    ],
  });
  await sendEmail({ to, subject: `投资人申请 · ${investor.legal_name}`, text: rendered.text, html: rendered.html });
}

export async function sendInvestorDecision(investor: { email: string; legal_name: string; preferred_language: string }, decision: "approved" | "rejected", note?: string | null) {
  const zh = investor.preferred_language !== "en";
  const approved = decision === "approved";
  const rendered = renderEmail({
    title: approved ? (zh ? "投资人账户已通过审核" : "Your investor account is approved") : zh ? "投资人申请未通过" : "Your investor application",
    blocks: [
      { type: "paragraph", text: approved ? (zh ? `${investor.legal_name}，你的投资人账户已开通，现在可以登录查看资产、收益和资金。` : `${investor.legal_name}, your investor account is now active. Sign in to see your assets, earnings and funds.`) : zh ? `${investor.legal_name}，很抱歉，你的投资人申请暂未通过。` : `${investor.legal_name}, unfortunately we could not approve your investor application at this time.` },
      ...(note ? [{ type: "paragraph" as const, text: note }] : []),
      ...(approved ? [{ type: "button" as const, label: zh ? "登录" : "Sign in", href: `${investorOrigin}/login` }] : []),
    ],
  });
  await sendEmail({ to: investor.email, subject: approved ? (zh ? "Movia 投资人账户已开通" : "Movia investor account approved") : zh ? "Movia 投资人申请结果" : "Movia investor application", text: rendered.text, html: rendered.html });
}
