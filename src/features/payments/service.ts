import "server-only";
import { adjustShareForRefund } from "@/features/investor/share";
import type Stripe from "stripe";
import { rootDomain } from "@/lib/env";
import { getStripe } from "@/lib/stripe";
import { notifyStaff } from "@/features/notifications/center";
import { notifyReservation } from "@/features/notifications/emails";
import { notifyOpsEmail } from "@/features/notifications/ops";
import { formatDate, formatMoney } from "@/lib/utils/format";
import { applyPrepay, prepayPreview } from "./prepay";
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

export async function savePaymentMethod(customerId: string, paymentMethodId: string | null) {
  if (!paymentMethodId) return;
  let brand: string | null = null;
  let last4: string | null = null;
  try {
    const method = await getStripe().paymentMethods.retrieve(paymentMethodId);
    brand = method.card?.brand ?? null;
    last4 = method.card?.last4 ?? null;
  } catch {}
  await createAdminClient().from("customers").update({ stripe_payment_method_id: paymentMethodId, stripe_card_brand: brand, stripe_card_last4: last4 }).eq("id", customerId);
}

export async function createSetupIntentFor(customerId: string) {
  const supabase = createAdminClient();
  const { data: customer } = await supabase.from("customers").select("id, full_name, email, phone, preferred_language, stripe_customer_id, stripe_payment_method_id").eq("id", customerId).maybeSingle();
  if (!customer) throw new PaymentError("customer_not_found");
  const stripeCustomerId = await ensureStripeCustomer({ customer } as ReservationForPayment);
  try {
    const intent = await getStripe().setupIntents.create({ customer: stripeCustomerId, usage: "off_session", payment_method_types: ["card"], metadata: { customer_id: customer.id, purpose: "card_setup" } });
    if (!intent.client_secret) throw new PaymentError("setup_unavailable");
    return { id: intent.id, clientSecret: intent.client_secret };
  } catch (cause) {
    if (cause instanceof PaymentError) throw cause;
    throw new PaymentError(stripeFailure(cause).code);
  }
}

export async function finalizeCardSetup(setupIntentId: string, customerId: string) {
  const intent = await getStripe().setupIntents.retrieve(setupIntentId);
  if (intent.metadata?.customer_id !== customerId || intent.status !== "succeeded") throw new PaymentError("setup_incomplete");
  const paymentMethodId = typeof intent.payment_method === "string" ? intent.payment_method : (intent.payment_method?.id ?? null);
  await savePaymentMethod(customerId, paymentMethodId);
  return paymentMethodId;
}

const reusableIntentStatuses = ["requires_payment_method", "requires_confirmation", "requires_action"];

export async function paidRentalCents(reservationId: string) {
  const { data } = await createAdminClient().from("payments").select("kind, status, amount_captured_cents, amount_refunded_cents").eq("reservation_id", reservationId);
  return (data ?? [])
    .filter((row) => ["RENTAL", "ADDITIONAL"].includes(row.kind) && ["SUCCEEDED", "PARTIALLY_REFUNDED", "REFUNDED"].includes(row.status))
    .reduce((sum, row) => sum + row.amount_captured_cents - row.amount_refunded_cents, 0);
}

export async function createRentalPaymentIntent(reservationId: string, options: { prepay?: boolean } = {}) {
  const reservation = await loadReservation(reservationId);
  if (!["REQUESTED", "PENDING_PAYMENT", "CONFIRMED"].includes(reservation.status)) throw new PaymentError("reservation_closed");
  const paid = await paidRentalCents(reservation.id);
  let amountCents = reservation.total_cents - paid;
  let discountCents = 0;
  if (options.prepay) {
    if (reservation.rate_plan !== "PAY_LATER" || paid > 0) throw new PaymentError("invalid_amount");
    const preview = await prepayPreview(reservation.id);
    if (!preview) throw new PaymentError("invalid_amount");
    amountCents = preview.totalCents;
    discountCents = preview.discountCents;
  } else if (reservation.rate_plan !== "PAY_LATER" && amountCents <= 0) {
    throw new PaymentError("already_paid");
  } else if (reservation.rate_plan === "PAY_LATER") {
    throw new PaymentError("invalid_amount");
  }
  if (amountCents <= 0) throw new PaymentError("invalid_amount");
  const supabase = createAdminClient();
  const stripe = getStripe();
  const { data: open } = await supabase
    .from("payments")
    .select("id, stripe_payment_intent_id, amount_cents")
    .eq("reservation_id", reservation.id)
    .eq("kind", "RENTAL")
    .eq("status", "PENDING")
    .is("stripe_checkout_session_id", null)
    .not("stripe_payment_intent_id", "is", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (open?.stripe_payment_intent_id) {
    let existing: Stripe.PaymentIntent | null = null;
    try {
      existing = await stripe.paymentIntents.retrieve(open.stripe_payment_intent_id);
    } catch {}
    if (existing && ["succeeded", "processing", "requires_capture"].includes(existing.status)) throw new PaymentError("processing");
    if (existing && open.amount_cents === amountCents && reusableIntentStatuses.includes(existing.status) && existing.client_secret && Boolean(existing.metadata?.prepay) === Boolean(options.prepay)) {
      return { paymentId: open.id as string, clientSecret: existing.client_secret, amountCents, discountCents, balance: paid > 0 };
    }
    await supabase.from("payments").update({ status: "CANCELLED" }).eq("id", open.id);
    if (existing && reusableIntentStatuses.includes(existing.status)) await stripe.paymentIntents.cancel(existing.id).catch(() => undefined);
  }
  const stripeCustomer = await ensureStripeCustomer(reservation);
  const { data: payment, error } = await supabase
    .from("payments")
    .insert({ reservation_id: reservation.id, customer_id: reservation.customer.id, kind: "RENTAL", amount_cents: amountCents, currency: reservation.currency, description: options.prepay ? "Rental payment (prepaid)" : paid > 0 ? "Balance payment" : "Rental payment", created_by: null })
    .select("id")
    .single();
  if (error || !payment) throw new PaymentError("payment_insert_failed");
  try {
    const intent = await stripe.paymentIntents.create(
      {
        amount: amountCents,
        currency: reservation.currency,
        customer: stripeCustomer,
        setup_future_usage: "off_session",
        payment_method_types: ["card"],
        description: `Movia rental ${reservation.number}`,
        metadata: { reservation_id: reservation.id, reservation_number: reservation.number, payment_id: payment.id, kind: "RENTAL", ...(options.prepay ? { prepay: "1" } : {}) },
      },
      { idempotencyKey: `intent:${payment.id}` },
    );
    await supabase.from("payments").update({ stripe_payment_intent_id: intent.id }).eq("id", payment.id);
    if (!intent.client_secret) throw new PaymentError("checkout_unavailable");
    return { paymentId: payment.id as string, clientSecret: intent.client_secret, amountCents, discountCents, balance: paid > 0 };
  } catch (cause) {
    const failure = stripeFailure(cause);
    await supabase.from("payments").update({ status: "FAILED", failure_code: failure.code, failure_message: failure.message }).eq("id", payment.id);
    if (cause instanceof PaymentError) throw cause;
    throw new PaymentError(failure.code);
  }
}

export async function settleRentalIntent(paymentIntentId: string, expectedReservationId?: string) {
  const supabase = createAdminClient();
  const intent = await getStripe().paymentIntents.retrieve(paymentIntentId, { expand: ["latest_charge"] });
  const paymentId = intent.metadata?.payment_id;
  const query = supabase.from("payments").select("id, reservation_id, customer_id, kind");
  const { data: payment } = paymentId ? await query.eq("id", paymentId).maybeSingle() : await query.eq("stripe_payment_intent_id", intent.id).maybeSingle();
  if (!payment || (expectedReservationId && payment.reservation_id !== expectedReservationId)) throw new PaymentError("payment_not_found");
  await applyIntent(payment.id, intent);
  if (intent.status !== "succeeded" || payment.kind !== "RENTAL") return { paymentId: payment.id as string, status: intent.status, confirmed: false };
  const { data: current } = await supabase.from("reservations").select("status").eq("id", payment.reservation_id).maybeSingle();
  if (current && ["EXPIRED", "CANCELLED", "NO_SHOW"].includes(current.status)) {
    await refundPayment(payment.id, intent.amount_received ?? intent.amount, "reservation_expired", null).catch(() => undefined);
    return { paymentId: payment.id as string, status: "expired", confirmed: false };
  }
  if (intent.metadata?.prepay === "1") await applyPrepay(payment.reservation_id);
  await savePaymentMethod(payment.customer_id, typeof intent.payment_method === "string" ? intent.payment_method : (intent.payment_method?.id ?? null));
  await notifyStaff({ kind: "payment.received", reservationId: payment.reservation_id, href: `/reservations/${payment.reservation_id}`, dedupeKey: `payment:${payment.id}`, params: { number: intent.metadata?.reservation_number ?? "", amount: formatMoney(intent.amount_received ?? intent.amount) } });
  const confirmed = await confirmReservationAfterPayment(payment.reservation_id, "payment");
  return { paymentId: payment.id as string, status: intent.status, confirmed };
}

export async function confirmReservationAfterPayment(reservationId: string, via: "payment" | "card") {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("reservations")
    .select("status, number, booking_source, pickup_at, return_at, total_cents, customer:customers(full_name), vehicle_class:vehicle_classes(name)")
    .eq("id", reservationId)
    .maybeSingle();
  const reservation = data as unknown as { status: string; number: string; booking_source: string | null; pickup_at: string; return_at: string; total_cents: number; customer: { full_name: string } | null; vehicle_class: { name: string } | null } | null;
  if (!reservation || !["REQUESTED", "PENDING_PAYMENT"].includes(reservation.status)) return false;
  if (reservation.status === "PENDING_PAYMENT") {
    const params = { number: reservation.number, name: reservation.customer?.full_name ?? "", vehicle: reservation.vehicle_class?.name ?? "", from: formatDate(reservation.pickup_at), to: formatDate(reservation.return_at), total: formatMoney(reservation.total_cents) };
    await notifyStaff({ kind: "reservation.requested", reservationId, href: `/reservations/${reservationId}`, dedupeKey: `new:${reservationId}`, params });
    await notifyOpsEmail(`新订单（已付款）/ New paid booking · ${reservation.number}`, [`${reservation.number} · ${params.vehicle} · ${params.from} → ${params.to}`, `${params.name} · ${params.total}`, `https://ops.${rootDomain}/reservations/${reservationId}`]);
  }
  const { error: transition } = await supabase.rpc("set_reservation_status", { p_reservation_id: reservationId, p_status: "CONFIRMED", p_reason: null });
  if (transition) return false;
  await supabase.from("audit_events").insert({ actor_type: "SYSTEM", action: "reservation.status_changed", entity_type: "reservation", entity_id: reservationId, metadata: { from: reservation.status, to: "CONFIRMED", by: "Stripe", via, number: reservation.number } });
  if (via === "card") await notifyStaff({ kind: "card.saved", reservationId, href: `/reservations/${reservationId}`, dedupeKey: `card:${reservationId}`, params: { number: reservation.number } });
  await notifyReservation("confirmed", reservationId, { dedupeKey: `confirmed:${reservationId}` }).catch(() => undefined);
  return true;
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
  const { data: payment } = await supabase.from("payments").select("id, reservation_id, kind, amount_captured_cents, amount_refunded_cents").eq("id", paymentId).maybeSingle();
  if (!payment) return;
  const refunded = charge.amount_refunded ?? 0;
  await supabase
    .from("payments")
    .update({ amount_refunded_cents: refunded, status: refunded >= payment.amount_captured_cents ? "REFUNDED" : refunded > 0 ? "PARTIALLY_REFUNDED" : "SUCCEEDED" })
    .eq("id", payment.id);
  await supabase.rpc("sync_reservation_payment_state", { p_reservation_id: payment.reservation_id });
  if (payment.kind === "RENTAL" && refunded > payment.amount_refunded_cents) await adjustShareForRefund(payment.reservation_id, refunded - payment.amount_refunded_cents).catch(() => undefined);
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
      if (payment.kind === "RENTAL") await adjustShareForRefund(payment.reservation_id, amountCents).catch(() => undefined);
    }
    return { refundId: refund.id as string, status: created.status ?? "pending" };
  } catch (cause) {
    await supabase.from("refunds").update({ status: "FAILED" }).eq("id", refund.id);
    throw new PaymentError(stripeFailure(cause).code);
  }
}

export async function createDraftIntent(amountCents: number, existingId?: string | null) {
  const stripe = getStripe();
  if (existingId) {
    try {
      const existing = await stripe.paymentIntents.retrieve(existingId);
      if (existing.metadata?.draft === "1" && existing.status === "requires_payment_method" && existing.client_secret) {
        const updated = existing.amount === amountCents ? existing : await stripe.paymentIntents.update(existingId, { amount: amountCents });
        if (updated.client_secret) return { id: updated.id, clientSecret: updated.client_secret, amountCents };
      }
    } catch {}
  }
  const intent = await stripe.paymentIntents.create({ amount: amountCents, currency: "usd", payment_method_types: ["card"], setup_future_usage: "off_session", metadata: { draft: "1" } });
  if (!intent.client_secret) throw new PaymentError("checkout_unavailable");
  return { id: intent.id, clientSecret: intent.client_secret, amountCents };
}

export async function attachDraftIntent(reservationId: string, paymentIntentId: string) {
  const reservation = await loadReservation(reservationId);
  const stripe = getStripe();
  const intent = await stripe.paymentIntents.retrieve(paymentIntentId);
  if (intent.metadata?.draft !== "1" || intent.status !== "requires_payment_method") throw new PaymentError("invalid_intent");
  const stripeCustomer = await ensureStripeCustomer(reservation);
  const supabase = createAdminClient();
  const { data: payment, error } = await supabase
    .from("payments")
    .insert({ reservation_id: reservation.id, customer_id: reservation.customer.id, kind: "RENTAL", amount_cents: reservation.total_cents, currency: reservation.currency, description: "Rental payment", stripe_payment_intent_id: intent.id, created_by: null })
    .select("id")
    .single();
  if (error || !payment) throw new PaymentError("payment_insert_failed");
  const updated = await stripe.paymentIntents.update(intent.id, {
    amount: reservation.total_cents,
    customer: stripeCustomer,
    setup_future_usage: "off_session",
    description: `Movia rental ${reservation.number}`,
    metadata: { draft: "", reservation_id: reservation.id, reservation_number: reservation.number, payment_id: payment.id, kind: "RENTAL" },
  });
  if (!updated.client_secret) throw new PaymentError("checkout_unavailable");
  return { paymentId: payment.id as string, clientSecret: updated.client_secret, amountCents: reservation.total_cents };
}
