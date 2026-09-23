export const offlineMethods = ["TRANSFER", "ZELLE", "CASH", "OTHER"] as const;
export type OfflineMethod = (typeof offlineMethods)[number];

export function isOfflineMethod(value: unknown): value is OfflineMethod {
  return typeof value === "string" && (offlineMethods as readonly string[]).includes(value);
}

type MethodSource = { offline_method: string | null; stripe_payment_intent_id: string | null; stripe_checkout_session_id?: string | null };

export function paymentMethod(row: MethodSource) {
  if (row.offline_method) return row.offline_method;
  return row.stripe_payment_intent_id || row.stripe_checkout_session_id ? "CARD" : "";
}

export function refundMethod(row: MethodSource & { amount_refunded_cents: number; refunds?: Array<{ status: string; offline_method: string | null }> | null }) {
  if (row.amount_refunded_cents <= 0) return "";
  if (!row.offline_method) return "CARD";
  const used = (row.refunds ?? []).filter((refund) => refund.status === "SUCCEEDED" && refund.offline_method).map((refund) => refund.offline_method as string);
  return [...new Set(used)].join("/");
}

export function offlineDueLeft(payments: Array<{ kind: string; amount_captured_cents: number; amount_refunded_cents: number; offline_method?: string | null }>, settlement: { offlineDueCents?: number; offlineKeptCents?: number } | null) {
  if (!settlement || (settlement.offlineDueCents ?? 0) <= 0) return 0;
  const held = payments.filter((payment) => payment.kind === "RENTAL" && payment.offline_method).reduce((sum, payment) => sum + payment.amount_captured_cents - payment.amount_refunded_cents, 0);
  return Math.max(0, Math.min(settlement.offlineDueCents ?? 0, held - (settlement.offlineKeptCents ?? 0)));
}

export type RefundablePayment = { id: string; amount_captured_cents: number; amount_refunded_cents: number; offline_method: string | null };

export function planCancellationRefunds(payments: RefundablePayment[], feeCents: number) {
  let feeRemaining = Math.max(0, feeCents);
  let offlineDueCents = 0;
  let offlineKeptCents = 0;
  const refunds: Array<{ paymentId: string; amountCents: number }> = [];
  for (const payment of payments) {
    const refundable = payment.amount_captured_cents - payment.amount_refunded_cents;
    if (refundable <= 0) continue;
    const retained = Math.min(refundable, feeRemaining);
    feeRemaining -= retained;
    if (payment.offline_method) offlineKeptCents += retained;
    const back = refundable - retained;
    if (back <= 0) continue;
    if (payment.offline_method) offlineDueCents += back;
    else refunds.push({ paymentId: payment.id, amountCents: back });
  }
  return { refunds, offlineDueCents, offlineKeptCents, feeRemaining };
}
