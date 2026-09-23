import { describe, expect, it } from "vitest";
import { zonedToUtc } from "../../booking/time";
import { priceHistory, type SnapshotRow } from "./history";
import type { Mapping } from "./mapping";
import { orderTargets, type OrderFacts, type OrderLine } from "./order-targets";

const la = (date: string, time: string) => zonedToUtc(date, time, "America/Los_Angeles").toISOString();
const laMs = (date: string, time: string) => zonedToUtc(date, time, "America/Los_Angeles").getTime();

let nextId = 1;
const lineSnap = (capturedAt: string, line: OrderLine): SnapshotRow => ({ id: nextId++, source_table: "reservation_line_items", source_id: line.id, captured_at: capturedAt, fields: { id: line.id, reservation_id: "r1", type: line.type, code: line.code, amount_cents: line.amount_cents, created_at: line.created_at }, deleted: false });
const gone = (capturedAt: string, id: string): SnapshotRow => ({ id: nextId++, source_table: "reservation_line_items", source_id: id, captured_at: capturedAt, fields: {}, deleted: true });
const orderSnap = (capturedAt: string, returnAt: string): SnapshotRow => ({ id: nextId++, source_table: "reservations", source_id: "r1", captured_at: capturedAt, fields: { id: "r1", return_at: returnAt }, deleted: false });

const rentalOld: OrderLine = { id: "l1", type: "RENTAL", code: "rental.monthly", amount_cents: 325080, created_at: "2026-11-20T00:00:00Z" };
const rentalNew: OrderLine = { id: "l2", type: "RENTAL", code: "rental.monthly", amount_cents: 400000, created_at: la("2027-01-10", "00:00") };
const due = la("2027-01-16", "06:00");
const newDue = la("2027-01-20", "06:00");

describe("priceHistory", () => {
  it("opens with the first known state and adds a reprice at the new lines' creation time", () => {
    const first = la("2026-11-24", "12:23");
    const later = la("2027-01-10", "00:23");
    const states = priceHistory({
      snapshots: [lineSnap(first, rentalOld), orderSnap(first, due), gone(later, "l1"), lineSnap(later, rentalNew), orderSnap(later, newDue)],
      currentLines: [rentalNew],
      currentReturnAt: newDue,
      returnedAt: null,
    });
    expect(states.map((state) => [state.at, state.end, state.lines.map((line) => line.amount_cents)])).toEqual([
      [Number.NEGATIVE_INFINITY, Date.parse(due), [325080]],
      [laMs("2027-01-10", "00:00"), Date.parse(newDue), [400000]],
    ]);
  });

  it("skips repeated identical snapshots and uses the live lines when no snapshot exists", () => {
    const first = la("2026-11-24", "12:23");
    const same = priceHistory({ snapshots: [lineSnap(first, rentalOld), orderSnap(first, due), lineSnap(la("2026-11-24", "13:23"), rentalOld)], currentLines: [rentalOld], currentReturnAt: due, returnedAt: null });
    expect(same).toHaveLength(1);
    const none = priceHistory({ snapshots: [], currentLines: [rentalOld], currentReturnAt: due, returnedAt: null });
    expect(none).toEqual([{ at: Number.NEGATIVE_INFINITY, end: Date.parse(due), lines: [rentalOld] }]);
  });

  it("adds the live lines when they changed after the last snapshot", () => {
    const first = la("2026-11-24", "12:23");
    const states = priceHistory({ snapshots: [lineSnap(first, rentalOld), orderSnap(first, due)], currentLines: [rentalNew], currentReturnAt: newDue, returnedAt: null });
    expect(states.map((state) => [state.at, state.lines[0].amount_cents])).toEqual([
      [Number.NEGATIVE_INFINITY, 325080],
      [laMs("2027-01-10", "00:00"), 400000],
    ]);
  });

  it("ends with the pricing in force at the actual return", () => {
    const first = la("2026-11-24", "12:23");
    const back = laMs("2027-01-12", "09:00");
    const states = priceHistory({ snapshots: [lineSnap(first, rentalOld), orderSnap(first, due)], currentLines: [rentalOld], currentReturnAt: due, returnedAt: back });
    expect(states.map((state) => [state.at, state.end])).toEqual([
      [Number.NEGATIVE_INFINITY, Date.parse(due)],
      [back, back],
    ]);
  });
});

describe("orderTargets with a price history", () => {
  const mappings: Mapping[] = [{ kind: "LINE", match: "RENTAL/*", account: "4010", mode: "SPREAD", version: 1, effective_from: "2026-01-01" }];
  const base: OrderFacts = {
    id: "r1",
    number: "MV-CRFBZ6",
    status: "ACTIVE",
    actualPickupAt: la("2026-12-19", "20:00"),
    returnAt: newDue,
    actualReturnAt: null,
    cancelledAt: null,
    completedAt: null,
    vehicleId: null,
    locationId: null,
    lines: [rentalNew],
    settlement: null,
    damages: [],
    companyVehicle: true,
    owner: null,
  };

  it("keeps December as recognized before the extension and spreads the increase afterwards", () => {
    const first = la("2026-11-24", "12:23");
    const later = la("2027-01-10", "00:23");
    const history = priceHistory({ snapshots: [lineSnap(first, rentalOld), orderSnap(first, due), gone(later, "l1"), lineSnap(later, rentalNew), orderSnap(later, newDue)], currentLines: [rentalNew], currentReturnAt: newDue, returnedAt: null });
    const built = orderTargets({ ...base, history }, { mappings, now: laMs("2027-01-15", "12:00") });
    const amount = (month: string) => built.items.find((entry) => entry.source_key === `order:r1:rec:${month}`)?.targets.find((target) => target.account === "4010")?.amount;
    expect(amount("2026-12")).toBe(-144260);
    expect(amount("2027-01")).toBe(-179409);
    const flat = orderTargets(base, { mappings, now: laMs("2027-01-15", "12:00") });
    const flatDecember = flat.items.find((entry) => entry.source_key === "order:r1:rec:2026-12")?.targets.find((target) => target.account === "4010")?.amount;
    expect(flatDecember).not.toBe(-144260);
  });
});
