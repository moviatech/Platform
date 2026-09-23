export type LedgerRow = {
  id: string;
  livemode: boolean;
  type: string;
  category: string;
  amount_cents: number;
  fee_cents: number;
  net_cents: number;
  currency: string;
  status: string;
  description: string | null;
  source_id: string | null;
  payment_intent_id: string | null;
  created_at: string;
  available_on: string | null;
};

type RawTransaction = {
  id: string;
  type: string;
  reporting_category?: string | null;
  amount: number;
  fee: number;
  net: number;
  currency: string;
  status: string;
  description?: string | null;
  created: number;
  available_on?: number | null;
  source?: unknown;
};

const idOf = (value: unknown): string | null => (typeof value === "string" ? value : value && typeof value === "object" && typeof (value as { id?: unknown }).id === "string" ? ((value as { id: string }).id as string) : null);

export function mapTransaction(item: RawTransaction, livemode: boolean): LedgerRow {
  const source = item.source && typeof item.source === "object" ? (item.source as Record<string, unknown>) : null;
  return {
    id: item.id,
    livemode,
    type: item.type,
    category: item.reporting_category ?? item.type,
    amount_cents: item.amount,
    fee_cents: item.fee,
    net_cents: item.net,
    currency: item.currency,
    status: item.status,
    description: item.description ?? null,
    source_id: idOf(item.source),
    payment_intent_id: source ? idOf(source.payment_intent) : null,
    created_at: new Date(item.created * 1000).toISOString(),
    available_on: item.available_on ? new Date(item.available_on * 1000).toISOString() : null,
  };
}

const chargeKinds = new Set(["charge", "payment"]);
const refundKinds = new Set(["refund", "payment_refund", "charge_failure", "payment_failure_refund"]);
const disputeKinds = new Set(["dispute", "dispute_reversal"]);
const payoutKinds = new Set(["payout", "payout_reversal"]);

export type StripeSummary = { chargesCents: number; refundsCents: number; disputesCents: number; feesCents: number; otherCents: number; netCents: number; payoutsCents: number; count: number };

type SummaryRow = Pick<LedgerRow, "category" | "amount_cents" | "fee_cents" | "net_cents">;

export function summarizeStripe(rows: SummaryRow[]): StripeSummary {
  const summary: StripeSummary = { chargesCents: 0, refundsCents: 0, disputesCents: 0, feesCents: 0, otherCents: 0, netCents: 0, payoutsCents: 0, count: rows.length };
  for (const row of rows) {
    if (payoutKinds.has(row.category)) {
      summary.payoutsCents -= row.amount_cents;
      continue;
    }
    summary.feesCents += row.fee_cents;
    summary.netCents += row.net_cents;
    if (chargeKinds.has(row.category)) summary.chargesCents += row.amount_cents;
    else if (refundKinds.has(row.category)) summary.refundsCents -= row.amount_cents;
    else if (disputeKinds.has(row.category)) summary.disputesCents -= row.amount_cents;
    else if (row.category === "fee") summary.feesCents -= row.amount_cents;
    else summary.otherCents += row.amount_cents;
  }
  return summary;
}

export const stripeFees = (rows: SummaryRow[]) => summarizeStripe(rows).feesCents;

export type SystemPayment = { id: string; intent: string; capturedCents: number; number: string | null };
export type StripeCharge = { id: string; intent: string | null; amountCents: number; createdAt: string };
export type Mismatch = { kind: "MISSING_IN_SYSTEM" | "MISSING_IN_STRIPE" | "AMOUNT"; reference: string; stripeCents: number | null; systemCents: number | null; number: string | null };

export function reconcile(charges: StripeCharge[], payments: SystemPayment[]): { matched: number; mismatches: Mismatch[] } {
  const byIntent = new Map<string, number>();
  for (const charge of charges) if (charge.intent) byIntent.set(charge.intent, (byIntent.get(charge.intent) ?? 0) + charge.amountCents);
  const known = new Map(payments.map((payment) => [payment.intent, payment]));
  const mismatches: Mismatch[] = [];
  let matched = 0;
  for (const charge of charges) if (!charge.intent || !known.has(charge.intent)) mismatches.push({ kind: "MISSING_IN_SYSTEM", reference: charge.intent ?? charge.id, stripeCents: charge.amountCents, systemCents: null, number: null });
  for (const payment of payments) {
    const stripeCents = byIntent.get(payment.intent);
    if (stripeCents === undefined) mismatches.push({ kind: "MISSING_IN_STRIPE", reference: payment.intent, stripeCents: null, systemCents: payment.capturedCents, number: payment.number });
    else if (stripeCents !== payment.capturedCents) mismatches.push({ kind: "AMOUNT", reference: payment.intent, stripeCents, systemCents: payment.capturedCents, number: payment.number });
    else matched += 1;
  }
  return { matched, mismatches };
}
