"use server";

import { revalidatePath } from "next/cache";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { isLocale, localeCookie } from "@/i18n/config";
import { notifyReservation } from "@/features/notifications/emails";
import { settleCancellation, type Settlement } from "@/features/payments/cancel-settlement";
import { createCheckout, PaymentError } from "@/features/payments/service";
import { audit } from "@/lib/audit";
import { getCustomerSession } from "@/lib/auth/customer";
import { clientIpFrom } from "@/lib/auth/client-ip";
import { portalOrigin } from "@/lib/env";
import { getStripe, stripeConfigured } from "@/lib/stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { agreementVersion, isLongTerm, renderAgreement, signatureImageInput, type Elections } from "./agreement";
import { loadAgreementFacts } from "./agreement-facts";

export type TripActionState = { ok?: boolean; error?: string; settlement?: Settlement };

const numberInput = z.string().regex(/^MV-[A-Z0-9]{6}$/);

async function ownedReservation(number: string) {
  const session = await getCustomerSession();
  if (!session) redirect("/login");
  const { data } = await createAdminClient()
    .from("reservations")
    .select("id, number, status, pickup_at, rate_plan, agreement_state")
    .eq("number", number)
    .eq("customer_id", session.customerId)
    .maybeSingle();
  return { session, reservation: data };
}

export async function startCheckout(form: FormData) {
  const parsed = numberInput.safeParse(form.get("number"));
  if (!parsed.success) return;
  const { session, reservation } = await ownedReservation(parsed.data);
  if (!reservation || !stripeConfigured()) return;
  try {
    const checkout = await createCheckout(reservation.id, { createdBy: null, holdMinutes: 24 * 60 - 5 });
    await audit({ actorUserId: session.userId, actorType: "CUSTOMER", action: "payment.link_created", entityType: "reservation", entityId: reservation.id, metadata: { by: "customer", paymentId: checkout.paymentId } });
    redirect(checkout.url);
  } catch (cause) {
    if (cause instanceof PaymentError) redirect(`/trips/${reservation.number}?error=${cause.code}`);
    throw cause;
  }
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
  const settlement = await settleCancellation(reservation.id, false, { userId: session.userId, type: "CUSTOMER", createdBy: null });
  await notifyReservation("cancelled", reservation.id).catch(() => undefined);
  revalidatePath(`/account/trips/${reservation.number}`);
  revalidatePath("/account/trips");
  return { ok: true, settlement };
}

const signInput = z.object({
  number: numberInput,
  signerName: z.string().trim().min(2).max(120),
  initials: z.string().trim().regex(/^\p{L}{1,6}$/u),
  waiverAck: z.literal("on"),
  locationAck: z.literal("on"),
  longTermAck: z.string().optional(),
  electronicComms: z.string().optional(),
  agree: z.literal("on"),
});

export async function signAgreement(_: TripActionState, form: FormData): Promise<TripActionState> {
  const parsed = signInput.safeParse({
    number: form.get("number"),
    signerName: form.get("signerName"),
    initials: form.get("initials"),
    waiverAck: form.get("waiverAck"),
    locationAck: form.get("locationAck"),
    longTermAck: form.get("longTermAck") ?? undefined,
    electronicComms: form.get("electronicComms") ?? undefined,
    agree: form.get("agree"),
  });
  if (!parsed.success) return { error: "invalid" };
  const signature = signatureImageInput.safeParse(form.get("signature"));
  if (!signature.success) return { error: "signatureInvalid" };
  const { session, reservation } = await ownedReservation(parsed.data.number);
  if (!reservation) return { error: "not_found" };
  if (["CANCELLED", "NO_SHOW", "EXPIRED", "COMPLETED"].includes(reservation.status)) return { error: "not_signable" };
  if (reservation.agreement_state === "SIGNED") return { ok: true };

  const stored = (await cookies()).get(localeCookie)?.value;
  const locale = isLocale(stored) ? stored : session.language;
  const facts = await loadAgreementFacts(reservation.id, locale);
  if (!facts) return { error: "failed" };
  const longTerm = isLongTerm(facts.rentalDays);
  if (longTerm && parsed.data.longTermAck !== "on") return { error: "invalid" };
  const electronic = parsed.data.electronicComms === "on";
  const elections: Elections = {
    waiverTier: facts.waiver.tier,
    waiverInitials: parsed.data.initials,
    locationInitials: parsed.data.initials,
    electronicComms: electronic,
    electronicInitials: electronic ? parsed.data.initials : null,
    longTermInitials: longTerm ? parsed.data.initials : null,
  };
  const signedAt = new Date().toISOString();
  const rendered = renderAgreement(locale, facts, { signerName: parsed.data.signerName, signedAt, elections });

  const head = await headers();
  const supabase = createAdminClient();
  const { count } = await supabase.from("agreements").select("id", { count: "exact", head: true }).eq("reservation_id", reservation.id);
  const version = (count ?? 0) + 1;
  await supabase.from("agreements").update({ superseded_at: signedAt }).eq("reservation_id", reservation.id).is("superseded_at", null);
  const { error } = await supabase.from("agreements").insert({
    reservation_id: reservation.id,
    customer_id: session.customerId,
    version,
    template_version: agreementVersion,
    locale,
    terms_snapshot: rendered.text,
    terms_hash: rendered.hash,
    signer_name: parsed.data.signerName,
    signer_ip: clientIpFrom(head),
    user_agent: head.get("user-agent")?.slice(0, 400) ?? null,
    signed_at: signedAt,
    elections,
    signature_image: signature.data,
  });
  if (error) return { error: "failed" };
  await supabase.from("reservations").update({ agreement_state: "SIGNED" }).eq("id", reservation.id);
  await audit({ actorUserId: session.userId, actorType: "CUSTOMER", action: "reservation.agreement_signed", entityType: "reservation", entityId: reservation.id, metadata: { by: parsed.data.signerName, version: agreementVersion, revision: version, locale, hash: rendered.hash, elections } });
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
  const session = await getCustomerSession();
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
  return { ok: true };
}
