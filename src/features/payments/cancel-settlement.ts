import "server-only";
import { stripeConfigured } from "@/lib/stripe";
import { loadActiveConfig } from "@/features/booking/service";
import { createAdminClient } from "@/lib/supabase/admin";
import { cancellationFeeCents, listDailyCents, type CancelPolicy } from "./cancellation";
import { chargeSavedCard, PaymentError, refundPayment } from "./service";

export type Settlement = {
  feeCents: number;
  refundedCents: number;
  chargedCents: number;
  uncollectedCents: number;
  error?: string;
};

type ReservationRow = {
  id: string;
  rental_days: number;
  total_cents: number;
  pickup_at: string;
  policy_snapshot: { cancelPolicy?: CancelPolicy } | null;
  quote_snapshot: { averageDailyCents?: number; multiplierBps?: number } | null;
  customer: { stripe_payment_method_id: string | null } | null;
};

export async function previewCancellationFee(reservation: ReservationRow, noShow: boolean, at = new Date()) {
  const policy = reservation.policy_snapshot?.cancelPolicy ?? (await loadActiveConfig()).data.cancelPolicy;
  return cancellationFeeCents({
    policy,
    rentalDays: reservation.rental_days,
    listDailyCents: listDailyCents(reservation.quote_snapshot?.averageDailyCents ?? 0, reservation.quote_snapshot?.multiplierBps ?? 10000),
    totalCents: reservation.total_cents,
    pickupAt: new Date(reservation.pickup_at),
    at,
    noShow,
  });
}

export type SettlementActor = { userId: string | null; type: "STAFF" | "CUSTOMER"; createdBy: string | null };

export async function settleCancellation(reservationId: string, noShow: boolean, actor: SettlementActor): Promise<Settlement> {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("reservations")
    .select("id, rental_days, total_cents, pickup_at, policy_snapshot, quote_snapshot, customer:customers(stripe_payment_method_id)")
    .eq("id", reservationId)
    .maybeSingle();
  const reservation = data as unknown as ReservationRow | null;
  if (!reservation) return { feeCents: 0, refundedCents: 0, chargedCents: 0, uncollectedCents: 0, error: "not_found" };

  const feeCents = await previewCancellationFee(reservation, noShow);
  const result: Settlement = { feeCents, refundedCents: 0, chargedCents: 0, uncollectedCents: 0 };

  const { data: payments } = await supabase
    .from("payments")
    .select("id, amount_captured_cents, amount_refunded_cents, status")
    .eq("reservation_id", reservationId)
    .eq("kind", "RENTAL")
    .in("status", ["SUCCEEDED", "PARTIALLY_REFUNDED"])
    .order("created_at");

  let feeRemaining = feeCents;
  try {
    if (stripeConfigured()) {
      for (const payment of payments ?? []) {
        const refundable = payment.amount_captured_cents - payment.amount_refunded_cents;
        if (refundable <= 0) continue;
        const retained = Math.min(refundable, feeRemaining);
        feeRemaining -= retained;
        const refundAmount = refundable - retained;
        if (refundAmount > 0) {
          await refundPayment(payment.id, refundAmount, noShow ? "no_show" : "cancellation", actor.createdBy);
          result.refundedCents += refundAmount;
        }
      }
      if (feeRemaining > 0 && reservation.customer?.stripe_payment_method_id) {
        await chargeSavedCard(reservationId, { amountCents: feeRemaining, description: noShow ? "No-show fee" : "Cancellation fee", kind: "CANCELLATION_FEE", createdBy: actor.createdBy });
        result.chargedCents = feeRemaining;
        feeRemaining = 0;
      }
    }
  } catch (cause) {
    result.error = cause instanceof PaymentError ? cause.code : "failed";
  }
  result.uncollectedCents = feeRemaining;

  await supabase.from("audit_events").insert({
    actor_user_id: actor.userId,
    actor_type: actor.type,
    action: noShow ? "reservation.no_show_settled" : "reservation.cancellation_settled",
    entity_type: "reservation",
    entity_id: reservationId,
    metadata: { ...result },
  });
  return result;
}

export type Collection = { outstandingCents: number; chargedCents: number; error?: string };

export async function collectBalanceAtStart(reservationId: string, actorUserId: string): Promise<Collection> {
  const supabase = createAdminClient();
  const [{ data: reservation }, { data: payments }] = await Promise.all([
    supabase.from("reservations").select("total_cents, customer:customers(stripe_payment_method_id)").eq("id", reservationId).maybeSingle(),
    supabase.from("payments").select("amount_captured_cents, amount_refunded_cents").eq("reservation_id", reservationId).eq("kind", "RENTAL").in("status", ["SUCCEEDED", "PARTIALLY_REFUNDED"]),
  ]);
  const row = reservation as unknown as { total_cents: number; customer: { stripe_payment_method_id: string | null } | null } | null;
  if (!row) return { outstandingCents: 0, chargedCents: 0, error: "not_found" };

  const paid = (payments ?? []).reduce((sum, payment) => sum + payment.amount_captured_cents - payment.amount_refunded_cents, 0);
  const outstanding = Math.max(0, row.total_cents - paid);
  const result: Collection = { outstandingCents: outstanding, chargedCents: 0 };
  if (outstanding === 0) return result;

  if (!stripeConfigured()) {
    result.error = "stripe_not_configured";
  } else if (!row.customer?.stripe_payment_method_id) {
    result.error = "no_saved_card";
  } else {
    try {
      await chargeSavedCard(reservationId, { amountCents: outstanding, description: "Rental balance at pickup", kind: "RENTAL", createdBy: actorUserId });
      result.chargedCents = outstanding;
    } catch (cause) {
      result.error = cause instanceof PaymentError ? cause.code : "failed";
    }
  }

  await supabase.from("audit_events").insert({
    actor_user_id: actorUserId,
    actor_type: "STAFF",
    action: result.error ? "payment.balance_collection_failed" : "payment.balance_collected",
    entity_type: "reservation",
    entity_id: reservationId,
    metadata: { ...result },
  });
  return result;
}
