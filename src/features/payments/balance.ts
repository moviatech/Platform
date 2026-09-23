export type OwedLine = { type: string; code: string; amount_cents: number };
export type OwedPayment = { id: string; kind: string; amount_captured_cents: number; amount_refunded_cents: number };

export type OrderDues = { rentDueCents: number; extrasDueCents: number; balanceCents: number };

export function orderDues(input: { totalCents: number; lines: OwedLine[]; payments: OwedPayment[]; claimPaymentIds: string[] }): OrderDues {
  const rentDue = input.totalCents - input.payments.filter((payment) => payment.kind === "RENTAL").reduce((sum, payment) => sum + payment.amount_captured_cents - payment.amount_refunded_cents, 0);
  const extras = input.lines.filter((line) => line.type === "ADDITIONAL" && !line.code.startsWith("manual.") && line.code !== "charge.cancellation").reduce((sum, line) => sum + line.amount_cents, 0);
  const charges = input.payments.filter((payment) => payment.kind === "ADDITIONAL" && !input.claimPaymentIds.includes(payment.id));
  const held = input.payments.filter((payment) => payment.kind === "SECURITY_HOLD").reduce((sum, payment) => sum + payment.amount_captured_cents, 0);
  const extrasDue = Math.max(0, extras - held - charges.reduce((sum, payment) => sum + payment.amount_captured_cents, 0));
  const overpaid = Math.max(0, charges.reduce((sum, payment) => sum + payment.amount_captured_cents - payment.amount_refunded_cents, 0) - extras);
  const balance = rentDue + extrasDue - (rentDue > 0 ? 0 : overpaid);
  return { rentDueCents: rentDue, extrasDueCents: Math.max(0, Math.min(balance, extrasDue)), balanceCents: balance };
}

export const orderBalance = (input: Parameters<typeof orderDues>[0]) => orderDues(input).balanceCents;
