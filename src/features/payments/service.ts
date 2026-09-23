import "server-only";
import type Stripe from "stripe";
import { rootDomain } from "@/lib/env";
import { getStripe } from "@/lib/stripe";
import { createAdminClient } from "@/lib/supabase/admin";

export class PaymentError extends Error {
  constructor(public code: string) {
    super(code);
  }
}

type ReservationForPayment = {
  id: string;
  number: string;
  status: string;
  payment_state: string;
  rate_plan: "PAY_NOW" | "PAY_LATER";
  total_cents: number;
  security_hold_cents: number;
  quote_snapshot: { depositCents?: number } | null;
  currency: string;
  customer: { id: string; full_name: string; email: string | null; phone: string | null; preferred_language: string; stripe_customer_id: string | null; stripe_payment_method_id: string | null };
  vehicle_class: { name: string } | null;
};

async function loadReservation(reservationId: string): Promise<ReservationForPayment> {
  const { data } = await createAdminClient()
    .from("reservations")
    .select(
      "id, number, status, payment_state, rate_plan, total_cents, security_hold_cents, quote_snapshot, currency, customer:customers(id, full_name, email, phone, preferred_language, stripe_customer_id, stripe_payment_method_id), vehicle_class:vehicle_classes(name)",
    )
    .eq("id", reservationId)
    .maybeSingle();
  if (!data) throw new PaymentError("reservation_not_found");
  return data as unknown as ReservationForPayment;
}

async function ensureStripeCustomer(reservation: ReservationForPayment) {
  const { customer } = reservation;
  if (customer.stripe_customer_id) return customer.stripe_customer_id;
  const created = await getStripe().customers.create(
    {
      name: customer.full_name,
      email: customer.email ?? undefined,
      phone: customer.phone ?? undefined,
      preferred_locales: [customer.preferred_language === "zh" ? "zh" : "en"],
      metadata: { customer_id: customer.id },
    },
    { idempotencyKey: `customer:${customer.id}` },
  );
  await createAdminClient().from("customers").update({ stripe_customer_id: created.id }).eq("id", customer.id);
  return created.id;
}

export async function createCardSetup(customerId: string, origin: string) {
  const supabase = createAdminClient();
  const { data: customer } = await supabase.from("customers").select("id, full_name, email, phone, preferred_language, stripe_customer_id").eq("id", customerId).maybeSingle();
  if (!customer) throw new PaymentError("customer_not_found");
  let stripeCustomerId = customer.stripe_customer_id;
  if (!stripeCustomerId) {
    const created = await getStripe().customers.create(
      {
        name: customer.full_name,
        email: customer.email ?? undefined,
        phone: customer.phone ?? undefined,
        preferred_locales: [customer.preferred_language === "zh" ? "zh" : "en"],
        metadata: { customer_id: customer.id },
      },
      { idempotencyKey: `customer:${customer.id}` },
    );
    await supabase.from("customers").update({ stripe_customer_id: created.id }).eq("id", customer.id);
    stripeCustomerId = created.id;
  }
  try {
    const session = await getStripe().checkout.sessions.create({
      mode: "setup",
      customer: stripeCustomerId,
      payment_method_types: ["card"],
      locale: customer.preferred_language === "zh" ? "zh" : "en",
      success_url: `${origin}/account?card=saved`,
      cancel_url: `${origin}/account`,
      metadata: { customer_id: customer.id, purpose: "card_setup" },
    });
    if (!session.url) throw new PaymentError("checkout_unavailable");
    return session.url;
  } catch (cause) {
    if (cause instanceof PaymentError) throw cause;
    throw new PaymentError(stripeFailure(cause).code);
  }
}

function stripeFailure(cause: unknown) {
  const error = cause as Stripe.errors.StripeError;
  return { code: error?.code ?? error?.type ?? "stripe_error", message: (error?.message ?? "Stripe request failed").slice(0, 500) };
}

export async function createCheckout(reservationId: string, options: { createdBy?: string | null; holdMinutes?: number } = {}) {
  const reservation = await loadReservation(reservationId);
  if (!["REQUESTED", "PENDING_PAYMENT", "CONFIRMED"].includes(reservation.status)) throw new PaymentError("reservation_closed");

  const supabase = createAdminClient();
  const payNow = reservation.rate_plan === "PAY_NOW";
  if (payNow && ["PAID", "PARTIALLY_REFUNDED", "REFUNDED"].includes(reservation.payment_state)) throw new PaymentError("already_paid");
  const { data: open } = await supabase
    .from("payments")
    .select("id, checkout_url, checkout_expires_at")
    .eq("reservation_id", reservation.id)
    .eq("kind", "RENTAL")
    .eq("status", "PENDING")
    .not("checkout_url", "is", null)
    .gt("checkout_expires_at", new Date(Date.now() + 10 * 60000).toISOString())
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (open?.checkout_url && open.checkout_expires_at) return { paymentId: open.id as string, url: open.checkout_url as string, expiresAt: new Date(open.checkout_expires_at) };
  const stripeCustomer = await ensureStripeCustomer(reservation);
  const expiresAt = new Date(Date.now() + Math.max(31, options.holdMinutes ?? 60) * 60000);

  const { data: payment, error } = await supabase
    .from("payments")
    .insert({
      reservation_id: reservation.id,
      customer_id: reservation.customer.id,
      kind: "RENTAL",
      amount_cents: payNow ? reservation.total_cents : 0,
      currency: reservation.currency,
      description: payNow ? "Rental payment" : "Card on file",
      checkout_expires_at: expiresAt.toISOString(),
      created_by: options.createdBy ?? null,
    })
    .select("id")
    .single();
  if (error || !payment) throw new PaymentError("payment_insert_failed");

  const accountBase = `https://account.${rootDomain}`;
  const metadata = { reservation_id: reservation.id, reservation_number: reservation.number, payment_id: payment.id };

  try {
    const session = await getStripe().checkout.sessions.create(
      {
        mode: payNow ? "payment" : "setup",
        customer: stripeCustomer,
        client_reference_id: reservation.number,
        locale: reservation.customer.preferred_language === "zh" ? "zh" : "en",
        expires_at: Math.floor(expiresAt.getTime() / 1000),
        success_url: `${accountBase}/checkout/success?r=${reservation.number}`,
        cancel_url: `${accountBase}/checkout/cancelled?r=${reservation.number}`,
        metadata,
        ...(payNow
          ? {
              line_items: [
                {
                  quantity: 1,
                  price_data: {
                    currency: reservation.currency,
                    unit_amount: reservation.total_cents,
                    product_data: { name: `Movia ${reservation.vehicle_class?.name ?? "rental"} · ${reservation.number}` },
                  },
                },
              ],
              payment_intent_data: { setup_future_usage: "off_session", metadata, description: `Movia rental ${reservation.number}` },
            }
          : { currency: reservation.currency, setup_intent_data: { metadata } }),
      },
      { idempotencyKey: `checkout:${payment.id}` },
    );

    await supabase.from("payments").update({ stripe_checkout_session_id: session.id, checkout_url: session.url }).eq("id", payment.id);
    return { paymentId: payment.id as string, url: session.url as string, expiresAt };
  } catch (cause) {
    const failure = stripeFailure(cause);
    await supabase.from("payments").update({ status: "FAILED", failure_code: failure.code, failure_message: failure.message }).eq("id", payment.id);
    throw new PaymentError(failure.code);
  }
}

async function offSessionIntent(
  reservation: ReservationForPayment,
  input: { kind: "RENTAL" | "SECURITY_HOLD" | "ADDITIONAL" | "CANCELLATION_FEE"; amountCents: number; description: string; manualCapture: boolean; createdBy?: string | null },
) {
  if (input.amountCents <= 0) throw new PaymentError("invalid_amount");
  const { customer } = reservation;
  if (!customer.stripe_customer_id || !customer.stripe_payment_method_id) throw new PaymentError("no_saved_card");

  const supabase = createAdminClient();
  const { data: payment, error } = await supabase
    .from("payments")
    .insert({
      reservation_id: reservation.id,
      customer_id: customer.id,
      kind: input.kind,
      amount_cents: input.amountCents,
      currency: reservation.currency,
      description: input.description,
      stripe_payment_method_id: customer.stripe_payment_method_id,
      created_by: input.createdBy ?? null,
    })
    .select("id")
    .single();
  if (error || !payment) throw new PaymentError("payment_insert_failed");

  try {
    const intent = await getStripe().paymentIntents.create(
      {
        amount: input.amountCents,
        currency: reservation.currency,
        customer: customer.stripe_customer_id,
        payment_method: customer.stripe_payment_method_id,
        off_session: true,
        confirm: true,
        capture_method: input.manualCapture ? "manual" : "automatic",
        ...(input.manualCapture ? { expand: ["latest_charge"], ...(process.env.STRIPE_EXTENDED_AUTH === "1" ? { payment_method_options: { card: { request_extended_authorization: "if_available" as const } } } : {}) } : {}),
        description: `${input.description} · ${reservation.number}`,
        metadata: { reservation_id: reservation.id, reservation_number: reservation.number, payment_id: payment.id, kind: input.kind },
      },
      { idempotencyKey: `intent:${payment.id}` },
    );
    await applyIntent(payment.id, intent);
    return { paymentId: payment.id as string, status: intent.status };
  } catch (cause) {
    const failure = stripeFailure(cause);
    const intentId = (cause as Stripe.errors.StripeError)?.payment_intent?.id ?? null;
    await supabase
      .from("payments")
      .update({ status: "FAILED", failure_code: failure.code, failure_message: failure.message, stripe_payment_intent_id: intentId })
      .eq("id", payment.id);
    await supabase.rpc("sync_reservation_payment_state", { p_reservation_id: reservation.id });
    throw new PaymentError(failure.code);
  }
}

export async function applyIntent(paymentId: string, intent: Stripe.PaymentIntent) {
  const supabase = createAdminClient();
  const status =
    intent.status === "succeeded"
      ? "SUCCEEDED"
      : intent.status === "requires_capture"
        ? "AUTHORIZED"
        : intent.status === "canceled"
          ? "CANCELLED"
          : intent.status === "requires_action"
            ? "REQUIRES_ACTION"
            : intent.status === "requires_payment_method"
              ? "FAILED"
              : "PENDING";

  const charge = typeof intent.latest_charge === "object" && intent.latest_charge ? intent.latest_charge : null;
  const captureBefore = charge?.payment_method_details?.card?.capture_before;

  const { data: payment } = await supabase
    .from("payments")
    .update({
      status,
      stripe_payment_intent_id: intent.id,
      stripe_payment_method_id: typeof intent.payment_method === "string" ? intent.payment_method : (intent.payment_method?.id ?? null),
      amount_captured_cents: intent.amount_received ?? 0,
      authorization_expires_at: status === "AUTHORIZED" ? new Date(captureBefore ? captureBefore * 1000 : Date.now() + 6 * 86400000).toISOString() : null,
      failure_code: intent.last_payment_error?.code ?? null,
      failure_message: intent.last_payment_error?.message?.slice(0, 500) ?? null,
    })
    .eq("id", paymentId)
    .select("reservation_id")
    .single();
  if (payment) await supabase.rpc("sync_reservation_payment_state", { p_reservation_id: payment.reservation_id });
}

export async function chargeSavedCard(reservationId: string, input: { amountCents: number; description: string; kind: "RENTAL" | "ADDITIONAL" | "CANCELLATION_FEE"; createdBy?: string | null }) {
  const reservation = await loadReservation(reservationId);
  return offSessionIntent(reservation, { ...input, manualCapture: false });
}

export async function placeSecurityHold(reservationId: string, createdBy?: string | null, options: { replacing?: string } = {}) {
  const reservation = await loadReservation(reservationId);
  const supabase = createAdminClient();
  let active = supabase.from("payments").select("id").eq("reservation_id", reservationId).eq("kind", "SECURITY_HOLD").eq("status", "AUTHORIZED");
  if (options.replacing) active = active.neq("id", options.replacing);
  const { data: existing } = await active.limit(1);
  if (existing?.length) throw new PaymentError("hold_already_active");
  const amountCents = reservation.security_hold_cents + (reservation.quote_snapshot?.depositCents ?? 0);
  return offSessionIntent(reservation, { kind: "SECURITY_HOLD", amountCents, description: "Security hold", manualCapture: true, createdBy });
}

async function loadPayment(paymentId: string) {
  const { data } = await createAdminClient()
    .from("payments")
    .select("id, reservation_id, kind, status, amount_cents, amount_captured_cents, amount_refunded_cents, stripe_payment_intent_id")
    .eq("id", paymentId)
    .maybeSingle();
  if (!data) throw new PaymentError("payment_not_found");
  return data;
}

export async function releaseHold(paymentId: string) {
  const payment = await loadPayment(paymentId);
  if (payment.kind !== "SECURITY_HOLD" || payment.status !== "AUTHORIZED" || !payment.stripe_payment_intent_id) throw new PaymentError("hold_not_active");
  try {
    const intent = await getStripe().paymentIntents.cancel(payment.stripe_payment_intent_id, { cancellation_reason: "requested_by_customer" }, { idempotencyKey: `release:${payment.id}` });
    await applyIntent(payment.id, intent);
  } catch (cause) {
    throw new PaymentError(stripeFailure(cause).code);
  }
}

export async function captureHold(paymentId: string, amountCents: number) {
  const payment = await loadPayment(paymentId);
  if (payment.kind !== "SECURITY_HOLD" || payment.status !== "AUTHORIZED" || !payment.stripe_payment_intent_id) throw new PaymentError("hold_not_active");
  if (amountCents <= 0 || amountCents > payment.amount_cents) throw new PaymentError("invalid_amount");
  try {
    const intent = await getStripe().paymentIntents.capture(payment.stripe_payment_intent_id, { amount_to_capture: amountCents }, { idempotencyKey: `capture:${payment.id}` });
    await applyIntent(payment.id, intent);
  } catch (cause) {
    throw new PaymentError(stripeFailure(cause).code);
  }
}

export async function applyChargeRefunds(paymentId: string, charge: Pick<Stripe.Charge, "amount_refunded">) {
  const supabase = createAdminClient();
  const { data: payment } = await supabase.from("payments").select("id, reservation_id, amount_captured_cents").eq("id", paymentId).maybeSingle();
  if (!payment) return;
  const refunded = charge.amount_refunded ?? 0;
  await supabase
    .from("payments")
    .update({ amount_refunded_cents: refunded, status: refunded >= payment.amount_captured_cents ? "REFUNDED" : refunded > 0 ? "PARTIALLY_REFUNDED" : "SUCCEEDED" })
    .eq("id", payment.id);
  await supabase.rpc("sync_reservation_payment_state", { p_reservation_id: payment.reservation_id });
}

export async function refundPayment(paymentId: string, amountCents: number, reason: string | null, createdBy?: string | null) {
  const payment = await loadPayment(paymentId);
  const supabase = createAdminClient();
  const { data: inFlight } = await supabase.from("refunds").select("amount_cents").eq("payment_id", payment.id).eq("status", "PENDING");
  const pendingCents = (inFlight ?? []).reduce((sum, row) => sum + row.amount_cents, 0);
  const refundable = payment.amount_captured_cents - payment.amount_refunded_cents - pendingCents;
  if (!payment.stripe_payment_intent_id || !["SUCCEEDED", "PARTIALLY_REFUNDED"].includes(payment.status)) throw new PaymentError("not_refundable");
  if (amountCents <= 0 || amountCents > refundable) throw new PaymentError("invalid_amount");

  const { data: refund, error } = await supabase
    .from("refunds")
    .insert({ payment_id: payment.id, amount_cents: amountCents, reason, created_by: createdBy ?? null })
    .select("id")
    .single();
  if (error || !refund) throw new PaymentError("refund_insert_failed");

  try {
    const created = await getStripe().refunds.create(
      { payment_intent: payment.stripe_payment_intent_id, amount: amountCents, metadata: { payment_id: payment.id, refund_id: refund.id } },
      { idempotencyKey: `refund:${refund.id}` },
    );
    await supabase.from("refunds").update({ stripe_refund_id: created.id, status: (created.status ?? "pending").toUpperCase() }).eq("id", refund.id);
    if (created.status === "succeeded") {
      const refunded = payment.amount_refunded_cents + amountCents;
      await supabase
        .from("payments")
        .update({ amount_refunded_cents: refunded, status: refunded >= payment.amount_captured_cents ? "REFUNDED" : "PARTIALLY_REFUNDED" })
        .eq("id", payment.id);
      await supabase.rpc("sync_reservation_payment_state", { p_reservation_id: payment.reservation_id });
    }
    return { refundId: refund.id as string, status: created.status ?? "pending" };
  } catch (cause) {
    await supabase.from("refunds").update({ status: "FAILED" }).eq("id", refund.id);
    throw new PaymentError(stripeFailure(cause).code);
  }
}
