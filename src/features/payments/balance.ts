export type OwedLine = { type: string; code: string; amount_cents: number };
export type OwedPayment = { id: string; kind: string; amount_captured_cents: number; amount_refunded_cents: number };

export type OrderDues = { rentDueCents: number; extrasDueCents: number; balanceCents: number };

export function orderDues(input: { totalCents: number; lines: OwedLine[]; payments: OwedPayment[]; claimPaymentIds: string[]; claimHeldCents?: number }): OrderDues {
  const rentDue = input.totalCents - input.payments.filter((payment) => payment.kind === "RENTAL").reduce((sum, payment) => sum + payment.amount_captured_cents - payment.amount_refunded_cents, 0);
  const extras = input.lines.filter((line) => line.type === "ADDITIONAL" && !line.code.startsWith("manual.") && line.code !== "charge.cancellation").reduce((sum, line) => sum + line.amount_cents, 0);
  const charges = input.payments.filter((payment) => payment.kind === "ADDITIONAL" && !input.claimPaymentIds.includes(payment.id));
  const held = Math.max(0, input.payments.filter((payment) => payment.kind === "SECURITY_HOLD").reduce((sum, payment) => sum + payment.amount_captured_cents, 0) - (input.claimHeldCents ?? 0));
  const extrasDue = Math.max(0, extras - held - charges.reduce((sum, payment) => sum + payment.amount_captured_cents, 0));
  const overpaid = Math.max(0, charges.reduce((sum, payment) => sum + payment.amount_captured_cents - payment.amount_refunded_cents, 0) - extras);
  const balance = rentDue + extrasDue - (rentDue > 0 ? 0 : overpaid);
  return { rentDueCents: rentDue, extrasDueCents: Math.max(0, Math.min(balance, extrasDue)), balanceCents: balance };
}

export function claimHeld(payments: OwedPayment[], claims: Array<{ payment_id: string | null; amount_cents: number }>) {
  const holds = new Set(payments.filter((payment) => payment.kind === "SECURITY_HOLD").map((payment) => payment.id));
  return claims.filter((claim) => claim.payment_id && holds.has(claim.payment_id)).reduce((sum, claim) => sum + claim.amount_cents, 0);
}

export const orderBalance = (input: Parameters<typeof orderDues>[0]) => orderDues(input).balanceCents;

export const checkoutCurrent = (amountCents: number, payNow: boolean, rentDueCents: number) => amountCents === 0 || (payNow && rentDueCents > 0 && amountCents === rentDueCents);
