"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { requireInvestor } from "@/lib/auth/investor";
import { hasStepUp } from "@/lib/auth/step-up";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatMoney } from "@/lib/utils/format";
import { getBankAccount, getWithdrawal } from "./banking";
import { LedgerError, loadBalances, postEntries } from "./ledger";
import { notifyStaffInvestorEvent } from "./notify";
import { loadInvestorSettings } from "./settings";

export type WithdrawalState = { ok?: boolean; error?: "invalid" | "step_up" | "min" | "insufficient" | "account" | "cooling" | "failed" | "status" };

const trimmed = (value: FormDataEntryValue | null) => String(value ?? "").trim();

export async function requestWithdrawal(_: WithdrawalState, form: FormData): Promise<WithdrawalState> {
  const session = await requireInvestor();
  if (!(await hasStepUp(session.userId))) return { error: "step_up" };
  const parsed = z.object({ amount: z.coerce.number().positive().max(10_000_000), bankAccountId: z.uuid() }).safeParse({ amount: trimmed(form.get("amount")).replace(/[,$\s]/g, ""), bankAccountId: form.get("bankAccountId") });
  if (!parsed.success) return { error: "invalid" };
  const amountCents = Math.round(parsed.data.amount * 100);
  const [settings, balances, account] = await Promise.all([loadInvestorSettings(), loadBalances(session.investorId), getBankAccount(parsed.data.bankAccountId, session.investorId)]);
  if (amountCents < settings.withdrawalMinCents) return { error: "min" };
  if (amountCents > balances.availableCents) return { error: "insufficient" };
  if (!account || account.removed_at) return { error: "account" };
  if (Date.parse(account.usable_after) > Date.now()) return { error: "cooling" };
  const admin = createAdminClient();
  const { data: withdrawal, error } = await admin.from("investor_withdrawals").insert({ investor_id: session.investorId, bank_account_id: account.id, amount_cents: amountCents, status: "REQUESTED" }).select("id").single();
  if (error || !withdrawal) return { error: "failed" };
  try {
    await postEntries(session.investorId, [{ type: "WITHHELD", bucket: "AVAILABLE", amountCents: -amountCents, withdrawalId: withdrawal.id, memo: `•••• ${account.last4}` }]);
  } catch (cause) {
    await admin.from("investor_withdrawals").delete().eq("id", withdrawal.id);
    return { error: cause instanceof LedgerError && cause.message === "insufficient_available" ? "insufficient" : "failed" };
  }
  await audit({ actorUserId: session.userId, actorType: "INVESTOR", action: "investor.withdrawal_requested", entityType: "investor_withdrawal", entityId: withdrawal.id, metadata: { amountCents, last4: account.last4 } });
  await notifyStaffInvestorEvent("investor_withdrawal_requested", { name: session.legalName, amount: formatMoney(amountCents), last4: account.last4 }, `/investors/${session.investorId}`, `withdrawal:${withdrawal.id}`);
  revalidatePath("/investor/funds", "layout");
  redirect("/funds?requested=1");
}

export async function cancelWithdrawal(_: WithdrawalState, form: FormData): Promise<WithdrawalState> {
  const session = await requireInvestor();
  const id = z.uuid().safeParse(form.get("id"));
  if (!id.success) return { error: "invalid" };
  const withdrawal = await getWithdrawal(id.data);
  if (!withdrawal || withdrawal.investor_id !== session.investorId || withdrawal.status !== "REQUESTED") return { error: "status" };
  const admin = createAdminClient();
  const { data } = await admin.from("investor_withdrawals").update({ status: "CANCELLED", reviewed_at: new Date().toISOString(), decision_note: "cancelled_by_investor" }).eq("id", withdrawal.id).eq("status", "REQUESTED").select("id");
  if (!data?.length) return { error: "status" };
  if (withdrawal.approval_id) await admin.from("approvals").update({ status: "DECLINED", decided_at: new Date().toISOString(), decision_note: "cancelled_by_investor" }).eq("id", withdrawal.approval_id).eq("status", "PENDING");
  await postEntries(session.investorId, [{ type: "WITHHOLD_RELEASE", bucket: "AVAILABLE", amountCents: withdrawal.amount_cents, withdrawalId: withdrawal.id, memo: "cancelled" }]);
  await audit({ actorUserId: session.userId, actorType: "INVESTOR", action: "investor.withdrawal_cancelled", entityType: "investor_withdrawal", entityId: withdrawal.id, metadata: { amountCents: withdrawal.amount_cents } });
  revalidatePath("/investor/funds", "layout");
  return { ok: true };
}
