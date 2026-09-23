import { computeShareBase, shareOf } from "../../investor/share-math";
import { laDate, todayStart } from "./dates";
import { matchLine, type Mapping } from "./mapping";
import { recognizeMonths, type SpreadState } from "./recognition";
import { item, type Built, type Issue, type PostingItem, type Tags, type Target } from "./types";

export type OrderLine = { id: string; type: string; code: string; amount_cents: number; created_at: string };
export type LineState = { at: number; end: number; lines: OrderLine[] };

export type OwnerAccrual = { investorId: string; eligible: boolean; revenueShareBps: number; shareBps: number; ledgerCents: number | null };

export type OrderFacts = {
  id: string;
  number: string;
  status: string;
  actualPickupAt: string | null;
  returnAt: string;
  actualReturnAt: string | null;
  cancelledAt: string | null;
  completedAt: string | null;
  vehicleId: string | null;
  locationId: string | null;
  lines: OrderLine[];
  history?: LineState[];
  settlement: { feeCents: number; uncollectedCents: number } | null;
  damages: Array<{ claimId: string; netCents: number; date: string }>;
  companyVehicle: boolean;
  owner: OwnerAccrual | null;
};

export type OrderContext = { mappings: Mapping[]; now: number };

export const SHARE_GRACE_DAYS = 3;
const sourceType = "reservation";

type Placed = { line: OrderLine; account: string; place: "spread" | "start" | "return" | "addl" } | { line: OrderLine; account: null; place: "unknown" } | { line: OrderLine; account: null; place: "none" };

function place(line: OrderLine, mappings: Mapping[], returnedAt: number | null): Placed {
  const mapping = matchLine(mappings, line.type, line.code);
  if (!mapping) return { line, account: null, place: "unknown" };
  if (mapping.mode === "NONE" || !mapping.account) return { line, account: null, place: "none" };
  if (mapping.mode === "SPREAD") {
    const late = line.code === "manual.discount" && returnedAt !== null && Date.parse(line.created_at) > returnedAt;
    return { line, account: mapping.account, place: late ? "addl" : "spread" };
  }
  if (line.type !== "ADDITIONAL") return { line, account: mapping.account, place: "start" };
  return { line, account: mapping.account, place: line.code.startsWith("fee.") ? "return" : "addl" };
}

const spreadKey = (account: string, type: string) => `${account}|${type}`;

function spreadAmounts(lines: OrderLine[], mappings: Mapping[], returnedAt: number | null) {
  const amounts: Record<string, number> = {};
  for (const placed of lines.map((line) => place(line, mappings, returnedAt))) {
    if (placed.place !== "spread" || placed.line.amount_cents === 0) continue;
    const key = spreadKey(placed.account, placed.line.type);
    amounts[key] = (amounts[key] ?? 0) + placed.line.amount_cents;
  }
  return amounts;
}

const expectedShare = (lines: OrderLine[], owner: OwnerAccrual) => shareOf(computeShareBase(lines).baseCents, owner.revenueShareBps, owner.shareBps);

function historyOf(order: OrderFacts, returnedAt: number | null): LineState[] {
  if (order.history && order.history.length > 0) return order.history;
  const planned = Date.parse(order.returnAt);
  const opening: LineState = { at: Number.NEGATIVE_INFINITY, end: planned, lines: order.lines };
  return returnedAt === null ? [opening] : [opening, { at: returnedAt, end: returnedAt, lines: order.lines }];
}

function receivableItem(order: OrderFacts, key: string, date: string, entries: Array<{ account: string; amount: number; revenueClass: string | null }>, tags: Tags, inputs: Record<string, unknown>): PostingItem | null {
  const targets: Target[] = [];
  let receivable = 0;
  for (const entry of entries) {
    if (entry.amount === 0) continue;
    targets.push({ account: entry.account, amount: -entry.amount, ...tags, revenue_class: entry.revenueClass });
    receivable += entry.amount;
  }
  if (targets.length === 0) return null;
  if (receivable !== 0) targets.push({ account: "1100", amount: receivable, ...tags });
  return item({ sourceType, sourceId: order.id, key, date, inputs: { number: order.number, ...inputs }, targets });
}

export function orderTargets(order: OrderFacts, context: OrderContext): Built {
  const items: PostingItem[] = [];
  const issues: Issue[] = [];
  const tags: Tags = { reservation_id: order.id, vehicle_id: order.vehicleId, location_id: order.locationId };
  const started = (order.status === "ACTIVE" || order.status === "COMPLETED") && order.actualPickupAt !== null;
  const returnedAt = order.status === "COMPLETED" && order.actualReturnAt ? Date.parse(order.actualReturnAt) : null;
  const placed = order.lines.map((line) => place(line, context.mappings, returnedAt));
  const push = (value: PostingItem | null) => {
    if (value) items.push(value);
  };

  for (const unknown of placed.filter((entry) => entry.place === "unknown")) {
    issues.push({ kind: "unmapped_line", dedupeKey: `unmapped_line:${order.id}:${unknown.line.type}/${unknown.line.code}`, reservationId: order.id, detail: { number: order.number, type: unknown.line.type, code: unknown.line.code, amountCents: unknown.line.amount_cents } });
  }

  if (started && order.actualPickupAt) {
    const start = Date.parse(order.actualPickupAt);
    const states = historyOf(order, returnedAt);
    const cutoff = returnedAt !== null ? Number.POSITIVE_INFINITY : todayStart(context.now);
    const spreadStates: SpreadState[] = states.map((state) => ({ at: state.at, end: state.end, amounts: spreadAmounts(state.lines, context.mappings, returnedAt) }));
    for (const month of recognizeMonths({ start, states: spreadStates, cutoff })) {
      const entries = Object.entries(month.amounts).map(([key, amount]) => {
        const [account, revenueClass] = key.split("|");
        return { account, amount, revenueClass };
      });
      push(receivableItem(order, `order:${order.id}:rec:${month.month}`, month.lastDate, entries, tags, { status: order.status, month: month.month, through: month.lastDate }));
    }

    const startLines = placed.filter((entry) => entry.place === "start");
    push(receivableItem(order, `order:${order.id}:start`, laDate(start), startLines.map((entry) => ({ account: entry.account as string, amount: entry.line.amount_cents, revenueClass: entry.line.type })), tags, { lines: startLines.map((entry) => entry.line.code) }));

    if (order.owner) {
      const owner = order.owner;
      if (owner.eligible) {
        const ownerStates: SpreadState[] = states.map((state, index) => {
          const last = index === states.length - 1;
          const amount = last && returnedAt !== null && owner.ledgerCents !== null ? owner.ledgerCents : expectedShare(state.lines, owner);
          return { at: state.at, end: state.end, amounts: { share: amount } };
        });
        const ownerTags: Tags = { ...tags, investor_id: owner.investorId };
        for (const month of recognizeMonths({ start, states: ownerStates, cutoff })) {
          const amount = month.amounts.share ?? 0;
          push(item({ sourceType, sourceId: order.id, key: `order:${order.id}:own:${month.month}`, date: month.lastDate, inputs: { number: order.number, month: month.month, shareBps: owner.shareBps, revenueShareBps: owner.revenueShareBps, ledger: owner.ledgerCents !== null }, targets: [{ account: "5010", amount, ...ownerTags }, { account: "2210", amount: -amount, ...ownerTags }] }));
        }
        const completedAt = order.completedAt ?? order.actualReturnAt;
        if (returnedAt !== null && owner.ledgerCents === null && completedAt && context.now - Date.parse(completedAt) > SHARE_GRACE_DAYS * 86400000) {
          issues.push({ kind: "share_missing", dedupeKey: `share_missing:${order.id}`, reservationId: order.id, investorId: owner.investorId, detail: { number: order.number, expectedCents: expectedShare(order.lines, owner) } });
        }
      }
    }
  }

  if (returnedAt !== null && order.actualReturnAt) {
    const returnLines = placed.filter((entry) => entry.place === "return");
    push(receivableItem(order, `order:${order.id}:return`, laDate(order.actualReturnAt), returnLines.map((entry) => ({ account: entry.account as string, amount: entry.line.amount_cents, revenueClass: entry.line.type })), tags, { lines: returnLines.map((entry) => entry.line.code) }));
  }

  const byDay = new Map<string, Array<{ account: string; amount: number; revenueClass: string | null; code: string }>>();
  for (const entry of placed) {
    if (entry.place !== "addl" && entry.place !== "unknown") continue;
    const day = laDate(entry.line.created_at);
    const list = byDay.get(day) ?? [];
    list.push({ account: entry.place === "unknown" ? "2900" : entry.account, amount: entry.line.amount_cents, revenueClass: entry.line.type, code: entry.line.code });
    byDay.set(day, list);
  }
  for (const [day, entries] of [...byDay].sort(([a], [b]) => a.localeCompare(b))) {
    push(receivableItem(order, `order:${order.id}:addl:${day}`, day, entries, tags, { lines: entries.map((entry) => entry.code) }));
  }

  if ((order.status === "CANCELLED" || order.status === "NO_SHOW") && order.settlement) {
    const kept = Math.max(0, order.settlement.feeCents - order.settlement.uncollectedCents);
    const date = laDate(order.cancelledAt ?? context.now);
    push(receivableItem(order, `order:${order.id}:cancel`, date, [{ account: "4070", amount: kept, revenueClass: order.status }], tags, { feeCents: order.settlement.feeCents, uncollectedCents: order.settlement.uncollectedCents }));
  }

  for (const damage of order.damages) {
    if (damage.netCents === 0) continue;
    const account = order.companyVehicle ? "4080" : "2900";
    push(receivableItem(order, `order:${order.id}:damage:${damage.claimId}`, damage.date, [{ account, amount: damage.netCents, revenueClass: "DAMAGE" }], tags, { claimId: damage.claimId, companyVehicle: order.companyVehicle }));
    if (!order.companyVehicle) issues.push({ kind: "damage_owner_vehicle", dedupeKey: `damage_owner_vehicle:${damage.claimId}`, reservationId: order.id, detail: { number: order.number, claimId: damage.claimId, netCents: damage.netCents } });
  }

  return { items, issues };
}
