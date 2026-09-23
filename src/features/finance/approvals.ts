import "server-only";
import { approveWithdrawal } from "@/features/investor/payouts";
import { captureHold, chargeSavedCard, PaymentError, refundPayment } from "@/features/payments/service";
import { addManualLine } from "@/features/reservations/apply-change";
import { sendEmail } from "@/lib/email";
import { rootDomain } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";

export const approvalThresholdCents = 10000;

export type ApprovalKind = "REFUND" | "CAPTURE" | "CHARGE" | "DISCOUNT" | "PAYOUT";

export type ApprovalRow = {
  id: string;
  kind: ApprovalKind;
  reservation_id: string | null;
  investor_withdrawal_id: string | null;
  requested_by: string | null;
  payment_id: string | null;
  amount_cents: number;
  reason: string | null;
  payload: Record<string, unknown>;
  status: "PENDING" | "APPROVED" | "DECLINED" | "FAILED";
  decided_at: string | null;
  decision_note: string | null;
  result: Record<string, unknown> | null;
  created_at: string;
  reservation: { number: string } | null;
  withdrawal: { investor_id: string; amount_cents: number; investor: { legal_name: string; investor_number: string } | null } | null;
  requester: { display_name: string } | null;
  decider: { display_name: string } | null;
};

const columns = "id, kind, reservation_id, investor_withdrawal_id, requested_by, payment_id, amount_cents, reason, payload, status, decided_at, decision_note, result, created_at, reservation:reservations(number), withdrawal:investor_withdrawals!approvals_investor_withdrawal_id_fkey(investor_id, amount_cents, investor:investors(legal_name, investor_number)), requester:staff_members!approvals_requested_by_fkey(display_name), decider:staff_members!approvals_decided_by_fkey(display_name)";

export async function requestApproval(input: { kind: ApprovalKind; reservationId: string; paymentId?: string | null; amountCents: number; reason: string; payload?: Record<string, unknown>; requestedBy: string; requesterName: string }) {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("approvals")
    .insert({ kind: input.kind, reservation_id: input.reservationId, payment_id: input.paymentId ?? null, amount_cents: input.amountCents, reason: input.reason || null, payload: input.payload ?? {}, requested_by: input.requestedBy })
    .select("id, reservation:reservations(number)")
    .single();
  const number = (data?.reservation as unknown as { number: string } | null)?.number ?? "";
  await supabase.from("audit_events").insert({ actor_user_id: input.requestedBy, actor_type: "STAFF", action: "approval.requested", entity_type: "reservation", entity_id: input.reservationId, metadata: { by: input.requesterName, approvalId: data?.id ?? null, kind: input.kind, amountCents: input.amountCents, reason: input.reason, number } });
  const notify = process.env.NOTIFY_EMAIL;
  if (notify) {
    await sendEmail({
      to: notify.split(",").map((item) => item.trim()).filter(Boolean),
      subject: `[Movia] 待审批 / Approval needed · ${input.kind} $${(input.amountCents / 100).toFixed(2)} · ${number}`,
      text: [`${number} · ${input.kind} · $${(input.amountCents / 100).toFixed(2)}`, `${input.requesterName}: ${input.reason}`, `https://ops.${rootDomain}/approvals`].join("\n"),
    }).catch(() => undefined);
  }
  return data?.id as string | undefined;
}

export async function requestPayoutApproval(input: { withdrawalId: string; amountCents: number; reason: string; requestedBy: string; requesterName: string }) {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("approvals")
    .insert({ kind: "PAYOUT", investor_withdrawal_id: input.withdrawalId, amount_cents: input.amountCents, reason: input.reason || null, payload: {}, requested_by: input.requestedBy })
    .select("id")
    .single();
  await supabase.from("audit_events").insert({ actor_user_id: input.requestedBy, actor_type: "STAFF", action: "approval.requested", entity_type: "investor_withdrawal", entity_id: input.withdrawalId, metadata: { by: input.requesterName, approvalId: data?.id ?? null, kind: "PAYOUT", amountCents: input.amountCents, reason: input.reason } });
  const notify = process.env.NOTIFY_EMAIL;
  if (notify) {
    await sendEmail({
      to: notify.split(",").map((item) => item.trim()).filter(Boolean),
      subject: `[Movia] 待审批 / Approval needed · PAYOUT $${(input.amountCents / 100).toFixed(2)}`,
      text: [`PAYOUT · $${(input.amountCents / 100).toFixed(2)}`, `${input.requesterName}: ${input.reason}`, `https://ops.${rootDomain}/approvals`].join("\n"),
    }).catch(() => undefined);
  }
  return data?.id as string | undefined;
}

export async function listApprovals(): Promise<{ pending: ApprovalRow[]; recent: ApprovalRow[] }> {
  const supabase = createAdminClient();
  const [{ data: pending }, { data: recent }] = await Promise.all([
    supabase.from("approvals").select(columns).eq("status", "PENDING").order("created_at"),
    supabase.from("approvals").select(columns).neq("status", "PENDING").order("decided_at", { ascending: false }).limit(20),
  ]);
  return { pending: (pending ?? []) as unknown as ApprovalRow[], recent: (recent ?? []) as unknown as ApprovalRow[] };
}

export async function countPendingApprovals() {
  const { count } = await createAdminClient().from("approvals").select("id", { count: "exact", head: true }).eq("status", "PENDING");
  return count ?? 0;
}

export async function executeApproval(row: ApprovalRow, actor: { userId: string; displayName: string }): Promise<{ ok: true; result: Record<string, unknown> } | { ok: false; error: string }> {
  try {
    switch (row.kind) {
      case "REFUND": {
        if (!row.payment_id) return { ok: false, error: "invalid" };
        const refund = await refundPayment(row.payment_id, row.amount_cents, row.reason, actor.userId);
        return { ok: true, result: { refundId: refund.refundId, status: refund.status } };
      }
      case "CAPTURE": {
        if (!row.payment_id) return { ok: false, error: "invalid" };
        await captureHold(row.payment_id, row.amount_cents);
        return { ok: true, result: { captured: row.amount_cents } };
      }
      case "CHARGE": {
        if (!row.reservation_id) return { ok: false, error: "invalid" };
        const kind = (row.payload.kind as "RENTAL" | "ADDITIONAL" | "CANCELLATION_FEE" | undefined) ?? "ADDITIONAL";
        const charge = await chargeSavedCard(row.reservation_id, { amountCents: row.amount_cents, description: row.reason ?? "Approved charge", kind, createdBy: actor.userId });
        if (typeof row.payload.claimId === "string") {
          await createAdminClient().from("damage_claims").update({ status: "CHARGED", payment_id: charge.paymentId, decided_by: actor.userId, updated_at: new Date().toISOString() }).eq("id", row.payload.claimId);
        }
        return { ok: true, result: { paymentId: charge.paymentId, status: charge.status } };
      }
      case "PAYOUT": {
        if (!row.investor_withdrawal_id) return { ok: false, error: "invalid" };
        const approved = await approveWithdrawal(row.investor_withdrawal_id, actor, row.reason);
        return approved ? { ok: true, result: { withdrawalId: row.investor_withdrawal_id } } : { ok: false, error: "invalid" };
      }
      case "DISCOUNT": {
        if (!row.reservation_id) return { ok: false, error: "invalid" };
        const applied = await addManualLine({ reservationId: row.reservation_id, kind: "discount", description: String(row.payload.description ?? row.reason ?? "Discount"), amountCents: row.amount_cents });
        if (!applied) return { ok: false, error: "failed" };
        return { ok: true, result: { totalCents: applied.totalCents } };
      }
    }
  } catch (cause) {
    return { ok: false, error: cause instanceof PaymentError ? cause.code : "failed" };
  }
  return { ok: false, error: "invalid" };
}
