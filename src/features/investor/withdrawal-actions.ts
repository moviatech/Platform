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
import { listMembers, loadMemberPosition } from "./members";
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
  const [settings, position, balances, account] = await Promise.all([
    loadInvestorSettings(),
    session.memberId ? loadMemberPosition(session.memberId, session.ownerId) : null,
    session.memberId ? null : loadBalances(session.ownerId),
    getBankAccount(parsed.data.bankAccountId, session.ownerId),
  ]);
  const availableCents = position?.availableCents ?? balances?.availableCents ?? 0;
  const leaving = Boolean(position && position.ratio === 0 && amountCents === position.availableCents);
  if (amountCents < settings.withdrawalMinCents && !leaving) return { error: "min" };
  if (amountCents > availableCents) return { error: "insufficient" };
  if (!account || account.removed_at || account.status !== "ACTIVE") return { error: "account" };
  if (Date.parse(account.usable_after) > Date.now()) return { error: "cooling" };
  if (!session.memberId && session.kind === "COMPANY") {
    const members = await listMembers(session.ownerId);
    const short = members.some((member) => {
      const share = Math.round(amountCents * member.ratio);
      return share > 0 && share > member.availableCents;
    });
    if (short) return { error: "insufficient" };
  }
  const admin = createAdminClient();
  let withdrawalId: string;
  if (session.memberId) {
    const { data, error } = await admin.rpc("investor_member_withdraw", { p_member: session.memberId, p_bank_account: account.id, p_amount: amountCents });
    if (error || !data) return { error: /insufficient/.test(error?.message ?? "") ? "insufficient" : /account_unusable/.test(error?.message ?? "") ? "account" : "failed" };
    withdrawalId = String(data);
  } else {
    const { data: withdrawal, error } = await admin.from("investor_withdrawals").insert({ investor_id: session.ownerId, bank_account_id: account.id, amount_cents: amountCents, status: "REQUESTED" }).select("id").single();
    if (error || !withdrawal) return { error: "failed" };
    try {
      await postEntries(session.ownerId, [{ type: "WITHHELD", bucket: "AVAILABLE", amountCents: -amountCents, withdrawalId: withdrawal.id, memo: `•••• ${account.last4}` }]);
    } catch (cause) {
      await admin.from("investor_withdrawals").delete().eq("id", withdrawal.id);
      return { error: cause instanceof LedgerError && cause.message === "insufficient_available" ? "insufficient" : "failed" };
    }
    withdrawalId = withdrawal.id;
  }
  await audit({ actorUserId: session.userId, actorType: "INVESTOR", action: "investor.withdrawal_requested", entityType: "investor_withdrawal", entityId: withdrawalId, metadata: { amountCents, last4: account.last4, ...(session.memberId ? { memberId: session.memberId, companyId: session.ownerId } : {}) } });
  const name = session.company ? `${session.legalName} · ${session.company.name}` : session.legalName;
  await notifyStaffInvestorEvent("investor_withdrawal_requested", { name, amount: formatMoney(amountCents), last4: account.last4 }, `/investors/${session.ownerId}`, `withdrawal:${withdrawalId}`);
  revalidatePath("/investor/funds", "layout");
  redirect("/funds?requested=1");
}

export async function cancelWithdrawal(_: WithdrawalState, form: FormData): Promise<WithdrawalState> {
  const session = await requireInvestor();
  const id = z.uuid().safeParse(form.get("id"));
  if (!id.success) return { error: "invalid" };
  const withdrawal = await getWithdrawal(id.data);
  if (!withdrawal || withdrawal.investor_id !== session.ownerId || (withdrawal.member_id ?? null) !== session.memberId || withdrawal.status !== "REQUESTED") return { error: "status" };
  const admin = createAdminClient();
  const { data } = await admin.from("investor_withdrawals").update({ status: "CANCELLED", reviewed_at: new Date().toISOString(), decision_note: "cancelled_by_investor" }).eq("id", withdrawal.id).eq("status", "REQUESTED").select("id");
  if (!data?.length) return { error: "status" };
  if (withdrawal.approval_id) await admin.from("approvals").update({ status: "DECLINED", decided_at: new Date().toISOString(), decision_note: "cancelled_by_investor" }).eq("id", withdrawal.approval_id).eq("status", "PENDING");
  await postEntries(session.ownerId, [{ type: "WITHHOLD_RELEASE", bucket: "AVAILABLE", amountCents: withdrawal.amount_cents, withdrawalId: withdrawal.id, memo: "cancelled" }]);
  await audit({ actorUserId: session.userId, actorType: "INVESTOR", action: "investor.withdrawal_cancelled", entityType: "investor_withdrawal", entityId: withdrawal.id, metadata: { amountCents: withdrawal.amount_cents } });
  revalidatePath("/investor/funds", "layout");
  return { ok: true };
}
