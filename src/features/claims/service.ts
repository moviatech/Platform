import "server-only";
import { chargeSavedCard, PaymentError } from "@/features/payments/service";
import { sendEmail } from "@/lib/email";
import { renderEmail } from "@/lib/email/template";
import { portalOrigin } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatMoney } from "@/lib/utils/format";

export type ClaimStatus = "PENDING_CONSENT" | "CONSENTED" | "DISPUTED" | "CHARGED" | "INSURANCE" | "CLOSED";

export type ClaimRow = {
  id: string;
  reservation_id: string;
  inspection_id: string | null;
  customer_id: string;
  amount_cents: number;
  description: string | null;
  status: ClaimStatus;
  consent_at: string | null;
  consent_text: string | null;
  dispute_note: string | null;
  payment_id: string | null;
  staff_note: string | null;
  created_at: string;
};

const columns = "id, reservation_id, inspection_id, customer_id, amount_cents, description, status, consent_at, consent_text, dispute_note, payment_id, staff_note, created_at";

async function audit(action: string, reservationId: string, actorUserId: string | null, actorType: "STAFF" | "CUSTOMER" | "SYSTEM", metadata: Record<string, unknown>) {
  await createAdminClient().from("audit_events").insert({ actor_user_id: actorUserId, actor_type: actorType, action, entity_type: "reservation", entity_id: reservationId, metadata });
}

export async function createDamageClaim(input: { reservationId: string; inspectionId: string | null; customerId: string; amountCents: number; description: string; createdBy: string; createdByName: string }) {
  const supabase = createAdminClient();
  const { data: claim } = await supabase
    .from("damage_claims")
    .insert({ reservation_id: input.reservationId, inspection_id: input.inspectionId, customer_id: input.customerId, amount_cents: input.amountCents, description: input.description || null, created_by: input.createdBy })
    .select("id")
    .single();
  if (!claim) return null;
  await audit("damage_claim.created", input.reservationId, input.createdBy, "STAFF", { by: input.createdByName, claimId: claim.id, amountCents: input.amountCents });
  const { data: reservation } = await supabase.from("reservations").select("number, customer:customers(email, preferred_language, full_name)").eq("id", input.reservationId).maybeSingle();
  const customer = (reservation?.customer as unknown as { email: string | null; preferred_language: string; full_name: string } | null) ?? null;
  if (customer?.email) {
    const zh = customer.preferred_language === "zh";
    const url = `${portalOrigin}/trips/${reservation?.number}`;
    const rendered = renderEmail({
      title: zh ? "车损确认" : "Damage confirmation",
      preheader: zh ? `请确认 ${formatMoney(input.amountCents)} 的车损赔付` : `Please review a ${formatMoney(input.amountCents)} damage charge`,
      blocks: [
        { type: "paragraph", text: zh ? `订单 ${reservation?.number} 还车时记录到车辆损伤，预估赔付 ${formatMoney(input.amountCents)}。加州法律要求我们在扣款前取得你的明确同意，请在客户中心查看照片和明细后确认或提出异议。` : `Damage was recorded when ${reservation?.number} was returned, with an estimated charge of ${formatMoney(input.amountCents)}. California law requires your express consent before we charge your card. Please review the photos and details in your account, then confirm or dispute.` },
        ...(input.description ? [{ type: "paragraph" as const, text: input.description }] : []),
        { type: "button", label: zh ? "查看并确认" : "Review and confirm", href: url },
      ],
    });
    await sendEmail({ to: customer.email, subject: zh ? `Movia 车损确认 · ${reservation?.number}` : `Movia damage confirmation · ${reservation?.number}`, text: rendered.text, html: rendered.html }).catch(() => undefined);
  }
  return claim.id as string;
}

export async function listClaims(reservationId: string): Promise<ClaimRow[]> {
  const { data } = await createAdminClient().from("damage_claims").select(columns).eq("reservation_id", reservationId).order("created_at");
  return (data ?? []) as ClaimRow[];
}

export async function getCustomerClaim(id: string, customerId: string): Promise<ClaimRow | null> {
  const { data } = await createAdminClient().from("damage_claims").select(columns).eq("id", id).eq("customer_id", customerId).maybeSingle();
  return (data as ClaimRow | null) ?? null;
}

export async function countClaimAttention() {
  const supabase = createAdminClient();
  const head = { count: "exact" as const, head: true };
  const [{ count: awaiting }, { count: disputed }, { count: consented }] = await Promise.all([
    supabase.from("damage_claims").select("id", head).eq("status", "PENDING_CONSENT"),
    supabase.from("damage_claims").select("id", head).eq("status", "DISPUTED"),
    supabase.from("damage_claims").select("id", head).eq("status", "CONSENTED"),
  ]);
  return { awaiting: awaiting ?? 0, disputed: disputed ?? 0, consented: consented ?? 0 };
}

export async function chargeClaim(claim: ClaimRow, actor: { userId: string | null; displayName: string; type: "STAFF" | "CUSTOMER" }): Promise<{ ok: true; paymentId: string } | { ok: false; error: string }> {
  const supabase = createAdminClient();
  const { data: reservation } = await supabase.from("reservations").select("number").eq("id", claim.reservation_id).maybeSingle();
  try {
    const charge = await chargeSavedCard(claim.reservation_id, { amountCents: claim.amount_cents, description: `Damage · ${reservation?.number ?? ""} · consented ${claim.consent_at ?? ""}`, kind: "ADDITIONAL", createdBy: actor.type === "STAFF" ? actor.userId : null });
    await supabase.from("damage_claims").update({ status: "CHARGED", payment_id: charge.paymentId, updated_at: new Date().toISOString() }).eq("id", claim.id);
    await audit("damage_claim.charged", claim.reservation_id, actor.userId, actor.type, { by: actor.displayName, claimId: claim.id, amountCents: claim.amount_cents, paymentId: charge.paymentId });
    return { ok: true, paymentId: charge.paymentId };
  } catch (cause) {
    const error = cause instanceof PaymentError ? cause.code : "failed";
    await audit("damage_claim.charge_failed", claim.reservation_id, actor.userId, actor.type, { by: actor.displayName, claimId: claim.id, amountCents: claim.amount_cents, code: error });
    return { ok: false, error };
  }
}
