import { laDate } from "./dates";
import { item, type Built, type Tags, type Target } from "./types";

export type StripeTxn = {
  id: string;
  livemode: boolean;
  type: string;
  category: string;
  amount_cents: number;
  fee_cents: number;
  net_cents: number;
  currency: string;
  payment_intent_id: string | null;
  created_at: string;
};

export type IntentOrder = { reservationId: string; included: boolean; vehicleId: string | null; locationId: string | null } | null;

const customerKinds = new Set(["charge", "payment", "refund", "payment_refund", "charge_failure", "payment_failure_refund", "refund_failure"]);
const payoutKinds = new Set(["payout", "payout_failure", "payout_cancel", "payout_reversal"]);
const feeKinds = new Set(["fee", "stripe_fee", "application_fee", "tax"]);

function counterOf(txn: StripeTxn, order: IntentOrder): { account: string; fee: string; tags: Tags; known: boolean } {
  const kind = customerKinds.has(txn.category) ? txn.category : customerKinds.has(txn.type) ? txn.type : txn.category;
  if (customerKinds.has(kind)) {
    if (!order) return { account: "2190", fee: "5030", tags: { stripe_id: txn.payment_intent_id }, known: true };
    const tags: Tags = { reservation_id: order.reservationId, vehicle_id: order.vehicleId, location_id: order.locationId, stripe_id: txn.payment_intent_id };
    return { account: order.included ? "1100" : "2910", fee: "5030", tags, known: true };
  }
  if (kind === "dispute" || kind === "dispute_reversal") return { account: "1150", fee: "5045", tags: { reservation_id: order?.reservationId ?? null, stripe_id: txn.payment_intent_id }, known: true };
  if (payoutKinds.has(kind) || payoutKinds.has(txn.type)) return { account: "1060", fee: "5030", tags: {}, known: true };
  if (feeKinds.has(kind) || feeKinds.has(txn.type)) return { account: "5030", fee: "5030", tags: {}, known: true };
  return { account: "2900", fee: "5030", tags: { stripe_id: txn.id }, known: false };
}

export function stripeTargets(txn: StripeTxn, order: IntentOrder): Built {
  if (!txn.livemode) return { items: [], issues: [] };
  if (txn.currency.toLowerCase() !== "usd") return { items: [], issues: [{ kind: "stripe_currency", dedupeKey: `stripe_currency:${txn.id}`, detail: { txn: txn.id, currency: txn.currency, amountCents: txn.amount_cents } }] };
  const counter = counterOf(txn, order);
  const targets: Target[] = [
    { account: "1050", amount: txn.net_cents },
    { account: counter.account, amount: -txn.amount_cents, ...counter.tags },
    { account: counter.fee, amount: txn.fee_cents, ...(counter.account === "1100" ? counter.tags : {}) },
  ];
  const merged = new Map<string, Target>();
  for (const target of targets) {
    const key = JSON.stringify({ ...target, amount: 0 });
    const current = merged.get(key);
    merged.set(key, current ? { ...current, amount: current.amount + target.amount } : target);
  }
  const posting = item({ sourceType: "stripe_txn", sourceId: txn.id, key: `stripe:${txn.id}`, date: laDate(txn.created_at), inputs: { type: txn.type, category: txn.category, amount: txn.amount_cents, fee: txn.fee_cents, net: txn.net_cents, intent: txn.payment_intent_id, order: order?.reservationId ?? null }, targets: [...merged.values()] });
  const issues = counter.known ? [] : [{ kind: "stripe_unknown_category", dedupeKey: `stripe_unknown_category:${txn.id}`, detail: { txn: txn.id, type: txn.type, category: txn.category, amountCents: txn.amount_cents } }];
  return { items: posting.targets.length > 0 ? [posting] : [], issues };
}

export type StripePayout = { id: string; livemode: boolean; status: string; amount_cents: number; arrival_date: string | null; created_at: string };

export function payoutArrivalTargets(payout: StripePayout): Built {
  if (!payout.livemode) return { items: [], issues: [] };
  const date = payout.arrival_date ? payout.arrival_date.slice(0, 10) : null;
  const paid = payout.status === "paid" && date !== null;
  const posting = item({ sourceType: "stripe_payout", sourceId: payout.id, key: `payout:${payout.id}`, date: date ?? laDate(payout.created_at), inputs: { status: payout.status, amount: payout.amount_cents, arrival: date }, targets: paid ? [{ account: "1080", amount: payout.amount_cents }, { account: "1060", amount: -payout.amount_cents }] : [] });
  return { items: [posting], issues: [] };
}

export type DisputeLost = { disputeId: string; amountCents: number; at: string; reservationId: string | null };

export function disputeLostTargets(event: DisputeLost): Built {
  const tags: Tags = { reservation_id: event.reservationId, stripe_id: event.disputeId };
  return {
    items: [item({ sourceType: "stripe_dispute", sourceId: event.disputeId, key: `dispute:${event.disputeId}:outcome`, date: laDate(event.at), inputs: { amount: event.amountCents }, targets: [{ account: "5040", amount: event.amountCents, ...tags }, { account: "1150", amount: -event.amountCents, ...tags }] })],
    issues: [],
  };
}
