"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requestPayoutApproval } from "@/features/finance/approvals";
import { audit } from "@/lib/audit";
import { requirePermission } from "@/lib/auth/staff";
import { decryptSecret } from "@/lib/crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatMoney } from "@/lib/utils/format";
import { getBankAccount, getWithdrawal } from "./banking";
import { postEntries } from "./ledger";
import { notifyInvestorEvent } from "./notify";
import { approveWithdrawal } from "./payouts";
import { loadInvestorSettings } from "./settings";

export type PayoutState = { ok?: boolean; error?: "invalid" | "status" | "failed" | "self" | "decrypt"; awaiting?: boolean; routing?: string; account?: string };

const uuid = z.uuid();
const trimmed = (value: FormDataEntryValue | null) => String(value ?? "").trim();

function refresh(investorId: string) {
  revalidatePath("/ops/investors");
  revalidatePath(`/ops/investors/${investorId}`);
  revalidatePath("/ops/approvals");
}

export async function reviewWithdrawal(_: PayoutState, form: FormData): Promise<PayoutState> {
  const session = await requirePermission("investor.finance");
  const parsed = z.object({ id: uuid, decision: z.enum(["approve", "decline"]), note: z.string().trim().max(1000).optional() }).safeParse({ id: form.get("id"), decision: form.get("decision"), note: trimmed(form.get("note")) });
  if (!parsed.success) return { error: "invalid" };
  const withdrawal = await getWithdrawal(parsed.data.id);
  if (!withdrawal || withdrawal.status !== "REQUESTED") return { error: "status" };
  const admin = createAdminClient();
  if (parsed.data.decision === "decline") {
    const { data } = await admin.from("investor_withdrawals").update({ status: "DECLINED", reviewed_by: session.userId, reviewed_at: new Date().toISOString(), decision_note: parsed.data.note || null }).eq("id", withdrawal.id).eq("status", "REQUESTED").select("id");
    if (!data?.length) return { error: "status" };
    if (withdrawal.approval_id) await admin.from("approvals").update({ status: "DECLINED", decided_by: session.userId, decided_at: new Date().toISOString(), decision_note: parsed.data.note || null }).eq("id", withdrawal.approval_id).eq("status", "PENDING");
    await postEntries(withdrawal.investor_id, [{ type: "WITHHOLD_RELEASE", bucket: "AVAILABLE", amountCents: withdrawal.amount_cents, withdrawalId: withdrawal.id, memo: parsed.data.note || "declined", createdBy: session.userId }]);
    await audit({ actorUserId: session.userId, actorType: "STAFF", action: "investor.withdrawal_declined", entityType: "investor_withdrawal", entityId: withdrawal.id, metadata: { by: session.displayName, amountCents: withdrawal.amount_cents, note: parsed.data.note || null } });
    await notifyInvestorEvent(withdrawal.investor_id, "withdrawal_declined", { amount: formatMoney(withdrawal.amount_cents), note: parsed.data.note ?? "" }, "/funds", { dedupeKey: `withdrawal_declined:${withdrawal.id}` });
    refresh(withdrawal.investor_id);
    return { ok: true };
  }
  if (withdrawal.approval_id && withdrawal.approval?.status === "PENDING") return { error: "status" };
  const settings = await loadInvestorSettings();
  if (withdrawal.amount_cents > settings.withdrawalApprovalCents) {
    const approvalId = await requestPayoutApproval({ withdrawalId: withdrawal.id, amountCents: withdrawal.amount_cents, reason: parsed.data.note || `${withdrawal.investor?.legal_name ?? ""} ${withdrawal.investor?.investor_number ?? ""}`.trim(), requestedBy: session.userId, requesterName: session.displayName });
    if (!approvalId) return { error: "failed" };
    await admin.from("investor_withdrawals").update({ approval_id: approvalId, reviewed_by: session.userId, reviewed_at: new Date().toISOString(), decision_note: parsed.data.note || null }).eq("id", withdrawal.id);
    await audit({ actorUserId: session.userId, actorType: "STAFF", action: "investor.withdrawal_approval_requested", entityType: "investor_withdrawal", entityId: withdrawal.id, metadata: { by: session.displayName, amountCents: withdrawal.amount_cents, approvalId } });
    refresh(withdrawal.investor_id);
    return { ok: true, awaiting: true };
  }
  const approved = await approveWithdrawal(withdrawal.id, { userId: session.userId, displayName: session.displayName }, parsed.data.note);
  if (!approved) return { error: "status" };
  refresh(withdrawal.investor_id);
  return { ok: true };
}

export async function markWithdrawalPaid(_: PayoutState, form: FormData): Promise<PayoutState> {
  const session = await requirePermission("investor.finance");
  const parsed = z.object({ id: uuid, reference: z.string().trim().min(1).max(120) }).safeParse({ id: form.get("id"), reference: trimmed(form.get("reference")) });
  if (!parsed.success) return { error: "invalid" };
  const withdrawal = await getWithdrawal(parsed.data.id);
  if (!withdrawal || withdrawal.status !== "APPROVED") return { error: "status" };
  const admin = createAdminClient();
  const { data } = await admin.from("investor_withdrawals").update({ status: "PAID", paid_by: session.userId, paid_reference: parsed.data.reference, paid_at: new Date().toISOString() }).eq("id", withdrawal.id).eq("status", "APPROVED").select("id");
  if (!data?.length) return { error: "status" };
  try {
    await postEntries(withdrawal.investor_id, [{ type: "WITHDRAWAL", bucket: "PAID_OUT", amountCents: withdrawal.amount_cents, withdrawalId: withdrawal.id, memo: parsed.data.reference, createdBy: session.userId }]);
  } catch {
    await admin.from("investor_withdrawals").update({ status: "APPROVED", paid_by: null, paid_reference: null, paid_at: null }).eq("id", withdrawal.id);
    return { error: "failed" };
  }
  await audit({ actorUserId: session.userId, actorType: "STAFF", action: "investor.withdrawal_paid", entityType: "investor_withdrawal", entityId: withdrawal.id, metadata: { by: session.displayName, amountCents: withdrawal.amount_cents, reference: parsed.data.reference } });
  await notifyInvestorEvent(withdrawal.investor_id, "withdrawal_paid", { amount: formatMoney(withdrawal.amount_cents), last4: withdrawal.bank_account?.last4 ?? "", reference: parsed.data.reference }, "/funds", { dedupeKey: `withdrawal_paid:${withdrawal.id}` });
  refresh(withdrawal.investor_id);
  return { ok: true };
}

export async function revealBankAccount(_: PayoutState, form: FormData): Promise<PayoutState> {
  const session = await requirePermission("investor.finance");
  const id = uuid.safeParse(form.get("id"));
  if (!id.success) return { error: "invalid" };
  const account = await getBankAccount(id.data);
  if (!account) return { error: "invalid" };
  let secret: { routing: string; account: string };
  try {
    secret = JSON.parse(decryptSecret(account.encrypted_payload)) as { routing: string; account: string };
  } catch {
    return { error: "decrypt" };
  }
  await audit({ actorUserId: session.userId, actorType: "STAFF", action: "investor.bank_account_revealed", entityType: "investor_bank_account", entityId: account.id, metadata: { by: session.displayName, investorId: account.investor_id, last4: account.last4 } });
  return { ok: true, routing: secret.routing, account: secret.account };
}
