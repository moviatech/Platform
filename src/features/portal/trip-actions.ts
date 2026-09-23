"use server";

import { revalidatePath } from "next/cache";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { isLocale, localeCookie } from "@/i18n/config";
import { notifyStaff } from "@/features/notifications/center";
import { notifyReservation } from "@/features/notifications/emails";
import { notifyOpsEmail } from "@/features/notifications/ops";
import { neverConfirmed, settleCancellation, type Settlement } from "@/features/payments/cancel-settlement";
import { audit } from "@/lib/audit";
import { getVerifiedCustomer } from "@/lib/auth/customer";
import { portalOrigin, rootDomain } from "@/lib/env";
import { getStripe, stripeConfigured } from "@/lib/stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatMoney } from "@/lib/utils/format";
import { signatureImageInput } from "./agreement";
import { readSignFields, signOnline } from "./sign-core";

export type TripActionState = { ok?: boolean; error?: string; settlement?: Settlement };

const numberInput = z.string().regex(/^MV-[A-Z0-9]{6}$/);

async function ownedReservation(number: string) {
  const session = await getVerifiedCustomer();
  if (!session) redirect("/login");
  const { data } = await createAdminClient()
    .from("reservations")
    .select("id, number, status, pickup_at, rate_plan, agreement_state")
    .eq("number", number)
    .eq("customer_id", session.customerId)
    .maybeSingle();
  return { session, reservation: data };
}

export async function startIdentity(form: FormData) {
  const parsed = numberInput.safeParse(form.get("number"));
  if (!parsed.success) return;
  const { session, reservation } = await ownedReservation(parsed.data);
  if (!reservation || !stripeConfigured()) return;

  const base = portalOrigin;
  let url: string | null = null;
  try {
    const verification = await getStripe().identity.verificationSessions.create({
      type: "document",
      client_reference_id: reservation.number,
      metadata: { customer_id: session.customerId, reservation_id: reservation.id },
      options: { document: { allowed_types: ["driving_license"], require_matching_selfie: true, require_live_capture: true } },
      return_url: `${base}/trips/${reservation.number}?identity=submitted`,
    });
    url = verification.url ?? null;
    await createAdminClient().from("customers").update({ identity_status: "SUBMITTED", identity_session_id: verification.id, identity_error: null }).eq("id", session.customerId);
    await createAdminClient().from("reservations").update({ verification_state: "SUBMITTED" }).eq("id", reservation.id);
    await audit({ actorUserId: session.userId, actorType: "CUSTOMER", action: "customer.identity_started", entityType: "customer", entityId: session.customerId, metadata: { sessionId: verification.id, number: reservation.number } });
  } catch (cause) {
    console.error("[identity:create]", cause instanceof Error ? cause.message : cause);
  }
  redirect(url ?? `/trips/${reservation.number}?error=identity_unavailable`);
}

export async function cancelTrip(_: TripActionState, form: FormData): Promise<TripActionState> {
  const parsed = numberInput.safeParse(form.get("number"));
  if (!parsed.success) return { error: "invalid" };
  const { session, reservation } = await ownedReservation(parsed.data);
  if (!reservation) return { error: "not_found" };
  if (!["REQUESTED", "PENDING_PAYMENT", "CONFIRMED"].includes(reservation.status)) return { error: "not_cancellable" };
  if (new Date(reservation.pickup_at).getTime() < Date.now()) return { error: "not_cancellable" };

  const supabase = createAdminClient();
  const { error } = await supabase.rpc("set_reservation_status", { p_reservation_id: reservation.id, p_status: "CANCELLED", p_reason: "customer" });
  if (error) return { error: "failed" };
  await audit({ actorUserId: session.userId, actorType: "CUSTOMER", action: "reservation.status_changed", entityType: "reservation", entityId: reservation.id, metadata: { by: "customer", number: reservation.number, from: reservation.status, to: "CANCELLED" } });
  const settlement = await settleCancellation(reservation.id, false, { userId: session.userId, type: "CUSTOMER", createdBy: null }, { waiveFee: neverConfirmed(reservation.status) });
  await notifyReservation("cancelled", reservation.id, { feeCents: settlement.feeCents, refundedCents: settlement.refundedCents, offlineDueCents: settlement.offlineDueCents }).catch(() => undefined);
  const outcome = { number: reservation.number, name: session.fullName, refunded: formatMoney(settlement.refundedCents), fee: formatMoney(settlement.feeCents), offline: formatMoney(settlement.offlineDueCents), error: settlement.error ?? "" };
  await notifyStaff({ kind: settlement.error ? "reservation.cancelled_error" : settlement.offlineDueCents > 0 ? "reservation.cancelled_offline" : "reservation.cancelled", reservationId: reservation.id, href: `/reservations/${reservation.id}`, params: outcome });
  await notifyOpsEmail(`客户取消订单 / Customer cancelled · ${reservation.number}`, [
    `${reservation.number} · ${session.fullName}`,
    `Refunded ${outcome.refunded} · Fee ${outcome.fee}${settlement.offlineDueCents > 0 ? ` · 需线下退还 / Return offline ${formatMoney(settlement.offlineDueCents)}` : ""}${settlement.error ? ` · Refund error: ${settlement.error}` : ""}`,
    `https://ops.${rootDomain}/reservations/${reservation.id}`,
  ]);
  revalidatePath(`/account/trips/${reservation.number}`);
  revalidatePath("/account/trips");
  return { ok: true, settlement };
}

export async function signAgreement(_: TripActionState, form: FormData): Promise<TripActionState> {
  const number = numberInput.safeParse(form.get("number"));
  const parsed = readSignFields(form);
  if (!number.success || !parsed.success) return { error: "invalid" };
  const signature = signatureImageInput.safeParse(form.get("signature"));
  if (!signature.success) return { error: "signatureInvalid" };
  const { session, reservation } = await ownedReservation(number.data);
  if (!reservation) return { error: "not_found" };

  const picked = String(form.get("lang") ?? "");
  const stored = (await cookies()).get(localeCookie)?.value;
  const locale = isLocale(picked) ? picked : isLocale(stored) ? stored : session.language;
  const result = await signOnline({ reservation, locale, fields: parsed.data, signature: signature.data, termsMark: String(form.get("termsMark") ?? ""), head: await headers(), actorUserId: session.userId, via: "portal" });
  if ("error" in result) return result;
  revalidatePath(`/account/trips/${reservation.number}`, "layout");
  return { ok: true };
}

const profileInput = z.object({
  fullName: z.string().trim().min(1).max(120),
  phone: z.string().trim().max(40),
  wechat: z.string().trim().max(60),
  dateOfBirth: z.union([z.literal(""), z.iso.date()]),
  address: z.string().trim().max(200),
});

export async function updateProfile(_: TripActionState, form: FormData): Promise<TripActionState> {
  const session = await getVerifiedCustomer();
  if (!session) redirect("/login");
  const parsed = profileInput.safeParse({
    fullName: form.get("fullName"),
    phone: form.get("phone") ?? "",
    wechat: form.get("wechat") ?? "",
    dateOfBirth: form.get("dateOfBirth") ?? "",
    address: form.get("address") ?? "",
  });
  if (!parsed.success) return { error: "invalid" };
  const stored = (await cookies()).get(localeCookie)?.value;
  const language = isLocale(stored) ? stored : session.language;
  const { error } = await createAdminClient()
    .from("customers")
    .update({
      full_name: parsed.data.fullName,
      phone: parsed.data.phone || null,
      wechat: parsed.data.wechat || null,
      date_of_birth: parsed.data.dateOfBirth || null,
      address: parsed.data.address || null,
      preferred_language: language,
    })
    .eq("id", session.customerId);
  if (error) return { error: error.code === "23505" ? "duplicate" : "failed" };
  revalidatePath("/account", "layout");
  redirect("/account?saved=1");
}
