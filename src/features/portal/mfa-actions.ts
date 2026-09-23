"use server";

import { createHash, randomInt } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { getCustomerSession, type CustomerSession } from "@/lib/auth/customer";
import { clearMfaCookie, setMfaCookie } from "@/lib/auth/mfa";
import { safeNext } from "@/lib/auth/next-url";
import { clientIp, record, throttled } from "@/lib/auth/throttle";
import { sendEmail } from "@/lib/email";
import { renderEmail } from "@/lib/email/template";
import { createAdminClient } from "@/lib/supabase/admin";

export type MfaState = { ok?: boolean; sent?: boolean; error?: "invalid" | "rate_limited" | "send_failed" | "code" };

const codeInput = z.string().trim().regex(/^\d{6}$/);
const codeTtlMs = 10 * 60 * 1000;

const hashCode = (code: string) => createHash("sha256").update(`${process.env.SUPABASE_SECRET_KEY ?? "movia"}:${code}`).digest("hex");

async function issueCode(session: CustomerSession): Promise<MfaState> {
  const ip = await clientIp();
  if (await throttled({ action: "mfa.send", minutes: 15, ip, perIp: 10, email: session.email, perEmail: 5 })) return { error: "rate_limited" };
  const code = String(randomInt(0, 1000000)).padStart(6, "0");
  await createAdminClient().from("customers").update({ mfa_code_hash: hashCode(code), mfa_code_expires_at: new Date(Date.now() + codeTtlMs).toISOString() }).eq("id", session.customerId);
  const zh = session.language === "zh";
  const rendered = renderEmail({
    preheader: zh ? `验证码 ${code}` : `Your code is ${code}`,
    title: zh ? "两步验证" : "Two-step verification",
    blocks: [
      { type: "paragraph", text: zh ? "输入这个验证码完成登录验证。10 分钟内有效。" : "Enter this code to finish verifying your sign-in. Valid for 10 minutes." },
      { type: "code", text: code },
      { type: "paragraph", text: zh ? "不是你本人操作的话，请立即修改密码。" : "If this wasn't you, change your password right away." },
    ],
  });
  const sent = await sendEmail({ to: session.email, subject: zh ? `Movia 验证码：${code}` : `Movia code: ${code}`, text: rendered.text, html: rendered.html });
  if (!sent.sent) return { error: "send_failed" };
  await record("mfa.send", session.email, ip);
  return { sent: true };
}

async function checkCode(session: CustomerSession, code: string) {
  const supabase = createAdminClient();
  const { data } = await supabase.from("customers").select("mfa_code_hash, mfa_code_expires_at").eq("id", session.customerId).maybeSingle();
  if (!data?.mfa_code_hash || !data.mfa_code_expires_at || Date.parse(data.mfa_code_expires_at) < Date.now()) return false;
  if (data.mfa_code_hash !== hashCode(code)) return false;
  await supabase.from("customers").update({ mfa_code_hash: null, mfa_code_expires_at: null }).eq("id", session.customerId);
  return true;
}

export async function startMfaSetup(): Promise<MfaState> {
  const session = await getCustomerSession();
  if (!session) redirect("/login");
  return issueCode(session);
}

export async function confirmMfaSetup(_: MfaState, form: FormData): Promise<MfaState> {
  const session = await getCustomerSession();
  if (!session) redirect("/login");
  const code = codeInput.safeParse(form.get("code"));
  if (!code.success) return { error: "invalid", sent: true };
  if (!(await checkCode(session, code.data))) return { error: "code", sent: true };
  await createAdminClient().from("customers").update({ mfa_enabled: true }).eq("id", session.customerId);
  await setMfaCookie(session.userId);
  await audit({ actorUserId: session.userId, actorType: "CUSTOMER", action: "customer.mfa_enabled", entityType: "customer", entityId: session.customerId, metadata: { by: session.fullName } });
  revalidatePath("/account", "layout");
  return { ok: true };
}

export async function disableMfa() {
  const session = await getCustomerSession();
  if (!session) redirect("/login");
  await createAdminClient().from("customers").update({ mfa_enabled: false, mfa_code_hash: null, mfa_code_expires_at: null }).eq("id", session.customerId);
  await clearMfaCookie();
  await audit({ actorUserId: session.userId, actorType: "CUSTOMER", action: "customer.mfa_disabled", entityType: "customer", entityId: session.customerId, metadata: { by: session.fullName } });
  revalidatePath("/account", "layout");
}

export async function sendMfaCode(_: MfaState, form: FormData): Promise<MfaState> {
  const session = await getCustomerSession();
  if (!session) redirect("/login");
  if (!session.mfaEnabled) redirect(safeNext(form.get("next")));
  return issueCode(session);
}

export async function verifyMfaCode(_: MfaState, form: FormData): Promise<MfaState> {
  const session = await getCustomerSession();
  if (!session) redirect("/login");
  const next = safeNext(form.get("next"));
  if (!session.mfaEnabled) redirect(next);
  const code = codeInput.safeParse(form.get("code"));
  if (!code.success) return { error: "invalid", sent: true };
  if (!(await checkCode(session, code.data))) return { error: "code", sent: true };
  await setMfaCookie(session.userId);
  await record("customer.mfa_verified", session.email, await clientIp());
  redirect(next);
}
