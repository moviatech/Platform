"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { applyPrepay, prepayPreview } from "@/features/payments/prepay";
import { chargeSavedCard, confirmReservationAfterPayment, finalizeCardSetup, paidRentalCents, PaymentError, settleRentalIntent } from "@/features/payments/service";
import { audit } from "@/lib/audit";
import { getCustomerSession } from "@/lib/auth/customer";
import { createAdminClient } from "@/lib/supabase/admin";

export type PayState = { ok?: boolean; error?: string };

const numberInput = z.string().regex(/^MV-[A-Z0-9]{6}$/);
const intentInput = z.string().regex(/^(pi|seti)_[A-Za-z0-9]+$/);

async function ownedReservation(number: string, customerId: string) {
  const { data } = await createAdminClient().from("reservations").select("id, number, status, rate_plan").eq("number", number).eq("customer_id", customerId).maybeSingle();
  return data;
}

export async function finalizePaymentAction(number: string, paymentIntentId: string): Promise<PayState> {
  const session = await getCustomerSession();
  if (!session) redirect("/login");
  if (!numberInput.safeParse(number).success || !intentInput.safeParse(paymentIntentId).success) return { error: "invalid" };
  const reservation = await ownedReservation(number, session.customerId);
  if (!reservation) return { error: "not_found" };
  try {
    const result = await settleRentalIntent(paymentIntentId, reservation.id);
    if (result.status !== "succeeded") return { error: "processing" };
    await audit({ actorUserId: session.userId, actorType: "CUSTOMER", action: "payment.succeeded", entityType: "reservation", entityId: reservation.id, metadata: { by: session.fullName, paymentId: result.paymentId, via: "elements" } });
    revalidatePath("/account", "layout");
    return { ok: true };
  } catch (cause) {
    return { error: cause instanceof PaymentError ? cause.code : "failed" };
  }
}

export async function finalizeCardSetupAction(setupIntentId: string, number?: string): Promise<PayState> {
  const session = await getCustomerSession();
  if (!session) redirect("/login");
  if (!intentInput.safeParse(setupIntentId).success) return { error: "invalid" };
  try {
    const paymentMethodId = await finalizeCardSetup(setupIntentId, session.customerId);
    await audit({ actorUserId: session.userId, actorType: "CUSTOMER", action: "customer.card_saved", entityType: "customer", entityId: session.customerId, metadata: { by: session.fullName, paymentMethodId, via: "elements" } });
    if (number && numberInput.safeParse(number).success) {
      const reservation = await ownedReservation(number, session.customerId);
      if (reservation?.rate_plan === "PAY_LATER") await confirmReservationAfterPayment(reservation.id, "card");
    }
    revalidatePath("/account", "layout");
    return { ok: true };
  } catch (cause) {
    return { error: cause instanceof PaymentError ? cause.code : "failed" };
  }
}

export async function payWithSavedCardAction(_: PayState, form: FormData): Promise<PayState> {
  const session = await getCustomerSession();
  if (!session) redirect("/login");
  const number = String(form.get("number") ?? "");
  const prepay = form.get("prepay") === "1";
  if (!numberInput.safeParse(number).success) return { error: "invalid" };
  const reservation = await ownedReservation(number, session.customerId);
  if (!reservation || !["REQUESTED", "PENDING_PAYMENT", "CONFIRMED"].includes(reservation.status)) return { error: "not_found" };
  let outcome: { paymentId: string; status: string } | null = null;
  try {
    let amountCents = 0;
    if (prepay) {
      const preview = reservation.rate_plan === "PAY_LATER" ? await prepayPreview(reservation.id) : null;
      if (!preview) return { error: "invalid" };
      amountCents = preview.totalCents;
    } else {
      const { data } = await createAdminClient().from("reservations").select("total_cents").eq("id", reservation.id).single();
      amountCents = (data?.total_cents ?? 0) - (await paidRentalCents(reservation.id));
    }
    if (amountCents <= 0) return { error: "already_paid" };
    outcome = await chargeSavedCard(reservation.id, { amountCents, description: prepay ? "Rental payment (prepaid)" : "Rental payment", kind: "RENTAL", createdBy: null });
    if (outcome.status !== "succeeded") return { error: outcome.status };
    if (prepay) await applyPrepay(reservation.id);
    await confirmReservationAfterPayment(reservation.id, "payment");
    await audit({ actorUserId: session.userId, actorType: "CUSTOMER", action: "payment.succeeded", entityType: "reservation", entityId: reservation.id, metadata: { by: session.fullName, paymentId: outcome.paymentId, via: "saved_card", amountCents } });
  } catch (cause) {
    return { error: cause instanceof PaymentError ? cause.code : "failed" };
  }
  revalidatePath("/account", "layout");
  redirect(`/trips/${number}?paid=1`);
}
