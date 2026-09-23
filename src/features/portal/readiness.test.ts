import { describe, expect, it } from "vitest";
import { fullyPaid, tripReadiness } from "./readiness";

const trip = { verification_state: "PENDING", agreement_state: "PENDING", rate_plan: "PAY_NOW" };
const facts = { paidCents: 0, totalCents: 30000, hasCard: false };

describe("tripReadiness", () => {
  it("ticks only the signed agreement when nothing else is done", () => {
    expect(tripReadiness({ ...trip, agreement_state: "SIGNED" }, facts)).toEqual({ license: false, agreement: true, payment: false, ready: false });
  });

  it("is ready only when the license, the agreement and the payment are all done", () => {
    const done = { ...trip, agreement_state: "SIGNED", verification_state: "VERIFIED" };
    expect(tripReadiness(done, { ...facts, paidCents: 30000 }).ready).toBe(true);
    expect(tripReadiness(done, { ...facts, paidCents: 10000 }).ready).toBe(false);
    expect(tripReadiness({ ...done, verification_state: "PENDING" }, { ...facts, paidCents: 30000 }).ready).toBe(false);
  });

  it("follows the order's own license check, the same one pickup uses", () => {
    expect(tripReadiness(trip, facts).license).toBe(false);
    expect(tripReadiness({ ...trip, verification_state: "VERIFIED" }, facts).license).toBe(true);
  });

  it("treats pay-later orders as settled once a card is on file", () => {
    expect(tripReadiness({ ...trip, rate_plan: "PAY_LATER" }, facts).payment).toBe(false);
    expect(tripReadiness({ ...trip, rate_plan: "PAY_LATER" }, { ...facts, hasCard: true }).payment).toBe(true);
    expect(tripReadiness(trip, { ...facts, hasCard: true }).payment).toBe(false);
  });

  it("keeps a pay-later order with a deposit settled by the card, and unsettled without one", () => {
    const later = { ...trip, rate_plan: "PAY_LATER" };
    expect(tripReadiness(later, { paidCents: 10000, totalCents: 30000, hasCard: true }).payment).toBe(true);
    expect(tripReadiness(later, { paidCents: 10000, totalCents: 30000, hasCard: false }).payment).toBe(false);
    expect(tripReadiness(later, { paidCents: 30000, totalCents: 30000, hasCard: false }).payment).toBe(true);
    expect(tripReadiness(trip, { paidCents: 10000, totalCents: 30000, hasCard: true }).payment).toBe(false);
  });

  it("needs no payment on a pay-now order with nothing to pay, but still a card on a pay-later one", () => {
    expect(tripReadiness(trip, { paidCents: 0, totalCents: 0, hasCard: false }).payment).toBe(true);
    expect(tripReadiness({ ...trip, rate_plan: "PAY_LATER" }, { paidCents: 0, totalCents: 0, hasCard: false }).payment).toBe(false);
    expect(tripReadiness({ ...trip, rate_plan: "PAY_LATER" }, { paidCents: 0, totalCents: 0, hasCard: true }).payment).toBe(true);
  });

  it("does not count a fully refunded payment", () => {
    expect(tripReadiness(trip, { ...facts, paidCents: 0, totalCents: 100 }).payment).toBe(false);
    expect(fullyPaid({ paidCents: 0, totalCents: 0 })).toBe(false);
    expect(fullyPaid({ paidCents: 30000, totalCents: 30000 })).toBe(true);
  });
});
