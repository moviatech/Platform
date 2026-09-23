import "server-only";
import type Stripe from "stripe";
import { getStripe, stripeConfigured } from "@/lib/stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { notifyReservation } from "@/features/notifications/emails";
import { applyChargeRefunds, applyIntent } from "./service";

type Outcome = "processed" | "ignored" | "duplicate";

async function audit(action: string, entityType: string, entityId: string, metadata: Record<string, unknown>) {
  await createAdminClient().from("audit_events").insert({ actor_type: "SYSTEM", action, entity_type: entityType, entity_id: entityId, metadata });
}

async function savePaymentMethod(customerId: string, paymentMethodId: string | null) {
  if (!paymentMethodId) return;
  let brand: string | null = null;
  let last4: string | null = null;
  if (stripeConfigured()) {
    try {
      const method = await getStripe().paymentMethods.retrieve(paymentMethodId);
      brand = method.card?.brand ?? null;
      last4 = method.card?.last4 ?? null;
    } catch {}
  }
  await createAdminClient().from("customers").update({ stripe_payment_method_id: paymentMethodId, stripe_card_brand: brand, stripe_card_last4: last4 }).eq("id", customerId);
}

const idOf = (value: string | { id: string } | null | undefined) => (typeof value === "string" ? value : (value?.id ?? null));

async function onCheckoutCompleted(session: Stripe.Checkout.Session): Promise<Outcome> {
  const supabase = createAdminClient();
  const { data: payment } = await supabase
    .from("payments")
    .select("id, reservation_id, customer_id, amount_cents")
    .eq("stripe_checkout_session_id", session.id)
    .maybeSingle();
  if (!payment) {
    const customerId = session.mode === "setup" && session.metadata?.purpose === "card_setup" ? session.metadata.customer_id : null;
    if (!customerId || !stripeConfigured() || !idOf(session.setup_intent)) return "ignored";
    const setup = await getStripe().setupIntents.retrieve(idOf(session.setup_intent) as string);
    await savePaymentMethod(customerId, idOf(setup.payment_method));
    await audit("customer.card_saved", "customer", customerId, { by: "Stripe", setupIntent: setup.id });
    return "processed";
  }

  let paymentMethodId: string | null = null;
  if (session.mode === "payment") {
    const paid = session.payment_status === "paid";
    await supabase
      .from("payments")
      .update({
        status: paid ? "SUCCEEDED" : "PENDING",
        stripe_payment_intent_id: idOf(session.payment_intent),
        amount_captured_cents: paid ? (session.amount_total ?? payment.amount_cents) : 0,
        checkout_url: null,
      })
      .eq("id", payment.id);
    if (stripeConfigured() && idOf(session.payment_intent)) {
      const intent = await getStripe().paymentIntents.retrieve(idOf(session.payment_intent) as string);
      paymentMethodId = idOf(intent.payment_method);
    }
  } else {
    await supabase.from("payments").update({ status: "SUCCEEDED", stripe_setup_intent_id: idOf(session.setup_intent), checkout_url: null }).eq("id", payment.id);
    if (stripeConfigured() && idOf(session.setup_intent)) {
      const setup = await getStripe().setupIntents.retrieve(idOf(session.setup_intent) as string);
      paymentMethodId = idOf(setup.payment_method);
    }
  }

  await savePaymentMethod(payment.customer_id, paymentMethodId);
  if (paymentMethodId) await supabase.from("payments").update({ stripe_payment_method_id: paymentMethodId }).eq("id", payment.id);
  await supabase.rpc("sync_reservation_payment_state", { p_reservation_id: payment.reservation_id });
  if (session.mode === "payment" && session.payment_status !== "paid") {
    await audit("payment.pending", "reservation", payment.reservation_id, { paymentId: payment.id, paymentStatus: session.payment_status, by: "Stripe" });
    return "processed";
  }

  const { data: reservation } = await supabase.from("reservations").select("status, number").eq("id", payment.reservation_id).single();
  if (reservation && ["REQUESTED", "PENDING_PAYMENT"].includes(reservation.status)) {
    await supabase.rpc("set_reservation_status", { p_reservation_id: payment.reservation_id, p_status: "CONFIRMED", p_reason: null });
    await audit("reservation.status_changed", "reservation", payment.reservation_id, { from: reservation.status, to: "CONFIRMED", by: "Stripe", number: reservation.number });
    await notifyReservation("confirmed", payment.reservation_id).catch(() => undefined);
  }
  await audit(session.mode === "payment" ? "payment.succeeded" : "payment.card_saved", "reservation", payment.reservation_id, {
    paymentId: payment.id,
    amountCents: session.amount_total ?? 0,
    by: "Stripe",
  });
  return "processed";
}

async function onCheckoutExpired(session: Stripe.Checkout.Session): Promise<Outcome> {
  const supabase = createAdminClient();
  const { data: payment } = await supabase.from("payments").select("id, reservation_id, status").eq("stripe_checkout_session_id", session.id).maybeSingle();
  if (!payment || payment.status !== "PENDING") return "ignored";
  await supabase.from("payments").update({ status: "CANCELLED", checkout_url: null }).eq("id", payment.id);

  const { data: live } = await supabase
    .from("payments")
    .select("id")
    .eq("reservation_id", payment.reservation_id)
    .eq("kind", "RENTAL")
    .eq("status", "PENDING")
    .not("checkout_url", "is", null)
    .gt("checkout_expires_at", new Date().toISOString())
    .limit(1);
  if (live?.length) return "processed";

  const { data: reservation } = await supabase.from("reservations").select("status, number").eq("id", payment.reservation_id).single();
  if (reservation?.status === "PENDING_PAYMENT") {
    await supabase.rpc("set_reservation_status", { p_reservation_id: payment.reservation_id, p_status: "EXPIRED", p_reason: "checkout_expired" });
    await audit("reservation.status_changed", "reservation", payment.reservation_id, { from: "PENDING_PAYMENT", to: "EXPIRED", by: "Stripe", number: reservation.number });
  }
  return "processed";
}

async function onIntent(intent: Stripe.PaymentIntent): Promise<Outcome> {
  const supabase = createAdminClient();
  const paymentId = intent.metadata?.payment_id;
  const query = supabase.from("payments").select("id, reservation_id");
  const { data: payment } = paymentId ? await query.eq("id", paymentId).maybeSingle() : await query.eq("stripe_payment_intent_id", intent.id).maybeSingle();
  if (!payment) return "ignored";
  await applyIntent(payment.id, intent);
  if (intent.status === "requires_payment_method" || intent.last_payment_error) {
    await audit("payment.failed", "reservation", payment.reservation_id, { paymentId: payment.id, code: intent.last_payment_error?.code ?? null, by: "Stripe" });
  }
  return "processed";
}

async function onCheckoutPaymentFailed(session: Stripe.Checkout.Session): Promise<Outcome> {
  const supabase = createAdminClient();
  const { data: payment } = await supabase.from("payments").select("id, reservation_id, status").eq("stripe_checkout_session_id", session.id).maybeSingle();
  if (!payment || payment.status !== "PENDING") return "ignored";
  await supabase.from("payments").update({ status: "FAILED", failure_code: "async_payment_failed", checkout_url: null }).eq("id", payment.id);
  await audit("payment.failed", "reservation", payment.reservation_id, { paymentId: payment.id, code: "async_payment_failed", by: "Stripe" });
  return "processed";
}

async function onChargeRefunded(charge: Stripe.Charge): Promise<Outcome> {
  const supabase = createAdminClient();
  const intentId = idOf(charge.payment_intent);
  if (!intentId) return "ignored";
  const { data: payment } = await supabase.from("payments").select("id").eq("stripe_payment_intent_id", intentId).maybeSingle();
  if (!payment) return "ignored";
  await applyChargeRefunds(payment.id, charge);
  return "processed";
}

async function onRefundUpdated(refund: Stripe.Refund): Promise<Outcome> {
  const supabase = createAdminClient();
  const { data: row } = await supabase.from("refunds").select("id, payment_id, status").eq("stripe_refund_id", refund.id).maybeSingle();
  if (!row) return "ignored";
  const status = (refund.status ?? "pending").toUpperCase();
  await supabase.from("refunds").update({ status }).eq("id", row.id);
  const { data: payment } = await supabase.from("payments").select("id, reservation_id").eq("id", row.payment_id).maybeSingle();
  if (!payment) return "processed";
  if (stripeConfigured() && idOf(refund.charge)) {
    try {
      const charge = await getStripe().charges.retrieve(idOf(refund.charge) as string);
      await applyChargeRefunds(payment.id, charge);
    } catch {}
  }
  if (status === "FAILED" || status === "CANCELED") {
    await audit("payment.refund_failed", "reservation", payment.reservation_id, { paymentId: payment.id, refundId: row.id, amountCents: refund.amount, reason: refund.failure_reason ?? null, by: "Stripe" });
  }
  return "processed";
}

async function onDispute(dispute: Stripe.Dispute): Promise<Outcome> {
  const supabase = createAdminClient();
  const intentId = idOf(dispute.payment_intent);
  if (!intentId) return "ignored";
  const { data: payment } = await supabase.from("payments").select("id, reservation_id").eq("stripe_payment_intent_id", intentId).maybeSingle();
  if (!payment) return "ignored";
  await audit("payment.dispute_opened", "reservation", payment.reservation_id, { paymentId: payment.id, amountCents: dispute.amount, reason: dispute.reason, by: "Stripe" });
  return "processed";
}

async function onIdentity(session: Stripe.Identity.VerificationSession): Promise<Outcome> {
  const supabase = createAdminClient();
  const { data: customer } = await supabase.from("customers").select("id").eq("identity_session_id", session.id).maybeSingle();
  if (!customer) return "ignored";

  if (session.status === "verified") {
    const patch: Record<string, unknown> = { identity_status: "VERIFIED", identity_verified_at: new Date().toISOString(), identity_error: null };
    if (stripeConfigured() && idOf(session.last_verification_report)) {
      try {
        const report = await getStripe().identity.verificationReports.retrieve(idOf(session.last_verification_report) as string, { expand: ["document.expiration_date", "document.number", "document.dob"] });
        const iso = (date: { year?: number | null; month?: number | null; day?: number | null } | null | undefined) =>
          date?.year && date.month && date.day ? `${date.year}-${String(date.month).padStart(2, "0")}-${String(date.day).padStart(2, "0")}` : null;
        patch.license_expires_on = iso(report.document?.expiration_date);
        patch.license_state = report.document?.issuing_country ?? null;
        patch.license_last4 = report.document?.number ? report.document.number.slice(-4) : null;
        const dob = iso(report.document?.dob);
        if (dob) patch.date_of_birth = dob;
      } catch {}
    }
    await supabase.from("customers").update(patch).eq("id", customer.id);
    await supabase.from("reservations").update({ verification_state: "VERIFIED" }).eq("customer_id", customer.id).in("status", ["REQUESTED", "PENDING_PAYMENT", "CONFIRMED"]);
    await audit("customer.identity_verified", "customer", customer.id, { sessionId: session.id, by: "Stripe" });
    return "processed";
  }
  if (session.status === "requires_input") {
    const reason = session.last_error?.reason ?? null;
    await supabase.from("customers").update({ identity_status: "REJECTED", identity_error: reason }).eq("id", customer.id);
    await supabase.from("reservations").update({ verification_state: "REJECTED" }).eq("customer_id", customer.id).in("status", ["REQUESTED", "PENDING_PAYMENT", "CONFIRMED"]);
    await audit("customer.identity_rejected", "customer", customer.id, { sessionId: session.id, reason, by: "Stripe" });
    return "processed";
  }
  return "ignored";
}

export async function processStripeEvent(event: Stripe.Event): Promise<Outcome> {
  const supabase = createAdminClient();
  const { error } = await supabase.from("stripe_events").insert({ id: event.id, type: event.type });
  if (error) {
    if (error.code !== "23505") throw new Error(`stripe_event_insert:${error.message}`);
    const { data: previous } = await supabase.from("stripe_events").select("processed_at").eq("id", event.id).single();
    if (previous?.processed_at) return "duplicate";
  }

  let outcome: Outcome = "ignored";
  switch (event.type) {
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded":
      outcome = await onCheckoutCompleted(event.data.object);
      break;
    case "checkout.session.expired":
      outcome = await onCheckoutExpired(event.data.object);
      break;
    case "checkout.session.async_payment_failed":
      outcome = await onCheckoutPaymentFailed(event.data.object);
      break;
    case "refund.updated":
    case "refund.failed":
    case "charge.refund.updated":
      outcome = await onRefundUpdated(event.data.object as Stripe.Refund);
      break;
    case "payment_intent.succeeded":
    case "payment_intent.payment_failed":
    case "payment_intent.canceled":
    case "payment_intent.amount_capturable_updated":
      outcome = await onIntent(event.data.object);
      break;
    case "charge.refunded":
      outcome = await onChargeRefunded(event.data.object);
      break;
    case "charge.dispute.created":
      outcome = await onDispute(event.data.object);
      break;
    case "identity.verification_session.verified":
    case "identity.verification_session.requires_input":
      outcome = await onIdentity(event.data.object);
      break;
  }

  await supabase.from("stripe_events").update({ processed_at: new Date().toISOString(), result: outcome }).eq("id", event.id);
  return outcome;
}
