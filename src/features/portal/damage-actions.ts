"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { chargeClaim, getCustomerClaim } from "@/features/claims/service";
import { clientIpFrom } from "@/lib/auth/client-ip";
import { getCustomerSession } from "@/lib/auth/customer";
import { sendEmail } from "@/lib/email";
import { rootDomain } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";

export type DamageState = { ok?: boolean; error?: string; charged?: boolean };

const consentInput = z.object({ claimId: z.uuid(), number: z.string().regex(/^MV-[A-Z0-9]{6}$/), agree: z.literal("on") });
const disputeInput = z.object({ claimId: z.uuid(), number: z.string().regex(/^MV-[A-Z0-9]{6}$/), note: z.string().trim().min(1).max(2000) });

export async function consentDamage(_: DamageState, form: FormData): Promise<DamageState> {
  const session = await getCustomerSession();
  if (!session) redirect("/login");
  const parsed = consentInput.safeParse({ claimId: form.get("claimId"), number: form.get("number"), agree: form.get("agree") });
  if (!parsed.success) return { error: "invalid" };
  const claim = await getCustomerClaim(parsed.data.claimId, session.customerId);
  if (!claim) return { error: "not_found" };
  if (claim.status !== "PENDING_CONSENT") return { error: "already_decided" };
  const head = await headers();
  const consentAt = new Date().toISOString();
  const consentText = `I authorize Movia to charge ${(claim.amount_cents / 100).toFixed(2)} USD for the vehicle damage described (${claim.description ?? ""}) to my card on file.`;
  const supabase = createAdminClient();
  await supabase.from("damage_claims").update({ status: "CONSENTED", consent_at: consentAt, consent_ip: clientIpFrom(head), consent_user_agent: head.get("user-agent")?.slice(0, 400) ?? null, consent_text: consentText, updated_at: consentAt }).eq("id", claim.id);
  await supabase.from("audit_events").insert({ actor_user_id: session.userId, actor_type: "CUSTOMER", action: "damage_claim.consented", entity_type: "reservation", entity_id: claim.reservation_id, metadata: { by: session.fullName, claimId: claim.id, amountCents: claim.amount_cents }, ip_address: clientIpFrom(head), user_agent: head.get("user-agent")?.slice(0, 400) ?? null });
  const result = await chargeClaim({ ...claim, status: "CONSENTED", consent_at: consentAt, consent_text: consentText }, { userId: session.userId, displayName: session.fullName, type: "CUSTOMER" });
  revalidatePath(`/account/trips/${parsed.data.number}`);
  return { ok: true, charged: result.ok };
}

export async function disputeDamage(_: DamageState, form: FormData): Promise<DamageState> {
  const session = await getCustomerSession();
  if (!session) redirect("/login");
  const parsed = disputeInput.safeParse({ claimId: form.get("claimId"), number: form.get("number"), note: form.get("note") ?? "" });
  if (!parsed.success) return { error: "invalid" };
  const claim = await getCustomerClaim(parsed.data.claimId, session.customerId);
  if (!claim) return { error: "not_found" };
  if (claim.status !== "PENDING_CONSENT") return { error: "already_decided" };
  const supabase = createAdminClient();
  await supabase.from("damage_claims").update({ status: "DISPUTED", dispute_note: parsed.data.note, updated_at: new Date().toISOString() }).eq("id", claim.id);
  await supabase.from("audit_events").insert({ actor_user_id: session.userId, actor_type: "CUSTOMER", action: "damage_claim.disputed", entity_type: "reservation", entity_id: claim.reservation_id, metadata: { by: session.fullName, claimId: claim.id, note: parsed.data.note } });
  const notify = process.env.NOTIFY_EMAIL;
  if (notify) {
    await sendEmail({
      to: notify.split(",").map((item) => item.trim()).filter(Boolean),
      subject: `[Movia] 车损异议 / Damage disputed · ${parsed.data.number}`,
      text: [`${parsed.data.number} · ${session.fullName}`, parsed.data.note, `https://ops.${rootDomain}/reservations/${claim.reservation_id}`].join("\n"),
    }).catch(() => undefined);
  }
  revalidatePath(`/account/trips/${parsed.data.number}`);
  return { ok: true };
}
