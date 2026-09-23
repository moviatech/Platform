import "server-only";
import { audit } from "@/lib/audit";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatMoney } from "@/lib/utils/format";
import { notifyInvestorEvent } from "./notify";

export async function approveWithdrawal(withdrawalId: string, actor: { userId: string; displayName: string }, note?: string | null) {
  const admin = createAdminClient();
  const { data } = await admin
    .from("investor_withdrawals")
    .update({ status: "APPROVED", reviewed_by: actor.userId, reviewed_at: new Date().toISOString(), decision_note: note ?? null })
    .eq("id", withdrawalId)
    .eq("status", "REQUESTED")
    .select("id, investor_id, amount_cents");
  const row = data?.[0];
  if (!row) return false;
  await audit({ actorUserId: actor.userId, actorType: "STAFF", action: "investor.withdrawal_approved", entityType: "investor_withdrawal", entityId: row.id, metadata: { by: actor.displayName, amountCents: row.amount_cents, note: note ?? null } });
  await notifyInvestorEvent(row.investor_id, "withdrawal_approved", { amount: formatMoney(row.amount_cents) }, "/funds", { dedupeKey: `withdrawal_approved:${row.id}` });
  return true;
}
