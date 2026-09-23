import type { Issue } from "./types";

export type Inclusion = "included" | "excluded" | "pending";

export function orderInclusion(facts: { test: boolean; liveStripe: boolean; override: boolean | null }): Inclusion {
  if (facts.override !== null) return facts.override ? "included" : "excluded";
  if (facts.test) return "excluded";
  return facts.liveStripe ? "included" : "pending";
}

export const investorIncluded = (facts: { house: boolean; override: boolean | null }) => (facts.override !== null ? facts.override : !facts.house);

export const PENDING_GRACE_MS = 3 * 3600000;

export function pendingInclusionIssue(order: { id: string; number: string; status: string; actualPickupAt: string | null }, inclusion: Inclusion, now: number): Issue | null {
  if (inclusion !== "pending" || (order.status !== "ACTIVE" && order.status !== "COMPLETED") || !order.actualPickupAt) return null;
  if (now - Date.parse(order.actualPickupAt) < PENDING_GRACE_MS) return null;
  return { kind: "inclusion_pending", dedupeKey: `inclusion_pending:${order.id}`, reservationId: order.id, detail: { number: order.number, status: order.status } };
}
