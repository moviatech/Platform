"use server";

import { z } from "zod";
import { requireInvestor } from "@/lib/auth/investor";
import { setStepUpCookie } from "@/lib/auth/step-up";
import { clientIp, record, throttled } from "@/lib/auth/throttle";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkInvestorMfaCode, issueInvestorMfaCode } from "./auth-core";

export type StepUpState = { sent?: boolean; ok?: boolean; error?: "invalid" | "rate_limited" | "send_failed" | "code" };

export async function sendStepUpCode(): Promise<StepUpState> {
  const session = await requireInvestor();
  const { data: investor } = await createAdminClient().from("investors").select("id, email, preferred_language").eq("id", session.investorId).single();
  if (!investor) return { error: "send_failed" };
  const failure = await issueInvestorMfaCode(investor);
  return failure ? { error: failure } : { sent: true };
}

export async function verifyStepUpCode(_: StepUpState, form: FormData): Promise<StepUpState> {
  const session = await requireInvestor();
  const code = z.string().trim().regex(/^\d{6}$/).safeParse(form.get("code"));
  if (!code.success) return { error: "invalid", sent: true };
  const ip = await clientIp();
  if (await throttled({ action: "investor.step_up_failed", minutes: 15, ip, perIp: 30, email: session.email, perEmail: 10 })) return { error: "rate_limited", sent: true };
  if (!(await checkInvestorMfaCode(session.investorId, code.data))) {
    await record("investor.step_up_failed", session.email, ip, "INVESTOR");
    return { error: "code", sent: true };
  }
  await setStepUpCookie(session.userId);
  await record("investor.step_up_verified", session.email, ip, "INVESTOR");
  return { ok: true };
}
