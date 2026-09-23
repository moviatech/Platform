"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { requirePermission } from "@/lib/auth/staff";
import { createAdminClient } from "@/lib/supabase/admin";
import { postEntries } from "@/features/investor/ledger";
import { notifyInvestorEvent } from "@/features/investor/notify";
import { formatMoney } from "@/lib/utils/format";
import { executeApproval, type ApprovalRow } from "./approvals";

export type ApprovalState = { ok?: boolean; error?: string };

const input = z.object({ approvalId: z.uuid(), decision: z.enum(["approve", "decline"]), note: z.string().trim().max(500) });

export async function decideApproval(_: ApprovalState, form: FormData): Promise<ApprovalState> {
  const session = await requirePermission("finance.approve");
  const parsed = input.safeParse({ approvalId: form.get("approvalId"), decision: form.get("decision"), note: form.get("note") ?? "" });
  if (!parsed.success) return { error: "invalid" };
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("approvals")
    .select("id, kind, reservation_id, investor_withdrawal_id, requested_by, payment_id, amount_cents, reason, payload, status, decided_at, decision_note, result, created_at, reservation:reservations(number), withdrawal:investor_withdrawals!approvals_investor_withdrawal_id_fkey(investor_id, amount_cents, investor:investors(legal_name, investor_number)), requester:staff_members!approvals_requested_by_fkey(display_name), decider:staff_members!approvals_decided_by_fkey(display_name)")
    .eq("id", parsed.data.approvalId)
    .maybeSingle();
  const row = data as unknown as ApprovalRow | null;
  if (!row) return { error: "not_found" };
  if (row.status !== "PENDING") return { error: "already_decided" };
  if (row.kind === "PAYOUT" && parsed.data.decision === "approve") {
    if (!session.roles.includes("SUPER_ADMIN")) return { error: "super_admin_required" };
    if (row.requested_by === session.userId) return { error: "same_person" };
  }

  const decidedAt = new Date().toISOString();
  let status: ApprovalRow["status"] = "DECLINED";
  let result: Record<string, unknown> | null = null;
  if (parsed.data.decision === "approve") {
    const outcome = await executeApproval(row, { userId: session.userId, displayName: session.displayName });
    status = outcome.ok ? "APPROVED" : "FAILED";
    result = outcome.ok ? outcome.result : { error: outcome.error };
  } else if (row.kind === "PAYOUT" && row.investor_withdrawal_id) {
    const { data: withdrawal } = await supabase.from("investor_withdrawals").update({ status: "DECLINED", reviewed_by: session.userId, reviewed_at: decidedAt, decision_note: parsed.data.note || null }).eq("id", row.investor_withdrawal_id).eq("status", "REQUESTED").select("id, investor_id, amount_cents");
    const target = withdrawal?.[0];
    if (target) {
      await postEntries(target.investor_id, [{ type: "WITHHOLD_RELEASE", bucket: "AVAILABLE", amountCents: target.amount_cents, withdrawalId: target.id, memo: parsed.data.note || "declined", createdBy: session.userId }]);
      await notifyInvestorEvent(target.investor_id, "withdrawal_declined", { amount: formatMoney(target.amount_cents), note: parsed.data.note ?? "" }, "/funds", { dedupeKey: `withdrawal_declined:${target.id}` });
    }
  }
  await supabase.from("approvals").update({ status, decided_by: session.userId, decided_at: decidedAt, decision_note: parsed.data.note || null, result }).eq("id", row.id);
  await audit({ actorUserId: session.userId, actorType: "STAFF", action: `approval.${status.toLowerCase()}`, entityType: row.reservation_id ? "reservation" : "investor_withdrawal", entityId: row.reservation_id ?? row.investor_withdrawal_id, metadata: { by: session.displayName, approvalId: row.id, kind: row.kind, amountCents: row.amount_cents, note: parsed.data.note || undefined, result } });
  revalidatePath("/ops", "layout");
  if (status === "FAILED") return { error: String(result?.error ?? "failed") };
  return { ok: true };
}
