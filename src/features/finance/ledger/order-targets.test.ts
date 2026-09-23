import { describe, expect, it } from "vitest";
import { zonedToUtc } from "../../booking/time";
import type { Mapping } from "./mapping";
import { orderTargets, type OrderFacts } from "./order-targets";
import type { PostingItem } from "./types";

const la = (date: string, time: string) => zonedToUtc(date, time, "America/Los_Angeles").toISOString();
const laMs = (date: string, time: string) => zonedToUtc(date, time, "America/Los_Angeles").getTime();

const mappings: Mapping[] = (
  [
    ["RENTAL/*", "4010", "SPREAD"],
    ["PROTECTION/*", "4020", "SPREAD"],
    ["ADD_ON/addon.childSeat", null, "NONE"],
    ["ADD_ON/*", "4030", "SPREAD"],
    ["YOUNG_DRIVER/*", "4030", "SPREAD"],
    ["DELIVERY/*", "4040", "ONCE"],
    ["DISCOUNT/discount.pay_now", "4910", "SPREAD"],
    ["DISCOUNT/discount.coupon_company", "4920", "SPREAD"],
    ["DISCOUNT/discount.coupon", "4925", "SPREAD"],
    ["DISCOUNT/manual.discount", "4930", "SPREAD"],
    ["TAX/*", "2100", "ONCE"],
    ["ADDITIONAL/fee.tax", "2100", "ONCE"],
    ["ADDITIONAL/fee.supercharging", "4060", "ONCE"],
    ["ADDITIONAL/fee.*", "4050", "ONCE"],
    ["ADDITIONAL/charge.toll", "4060", "ONCE"],
    ["ADDITIONAL/charge.cancellation", "4070", "ONCE"],
    ["ADDITIONAL/charge.additional", "4090", "ONCE"],
    ["ADDITIONAL/manual.fee", "4090", "ONCE"],
  ] as const
).map(([match, account, mode]) => ({ kind: "LINE", match, account, mode, version: 1, effective_from: "2026-01-01" }));

const booked = "2026-11-20T00:00:00Z";
const crfbz6: OrderFacts = {
  id: "res-crfbz6",
  number: "MV-CRFBZ6",
  status: "COMPLETED",
  actualPickupAt: la("2026-12-19", "20:00"),
  returnAt: la("2027-01-16", "06:00"),
  actualReturnAt: la("2027-01-16", "06:00"),
  cancelledAt: null,
  completedAt: la("2027-01-16", "07:00"),
  vehicleId: "veh-my111926",
  locationId: "loc-irvine",
  lines: [
    { id: "l1", type: "RENTAL", code: "rental.monthly", amount_cents: 325080, created_at: booked },
    { id: "l2", type: "PROTECTION", code: "protection.full", amount_cents: 84000, created_at: booked },
    { id: "l3", type: "ADD_ON", code: "addon.driver", amount_cents: 0, created_at: booked },
    { id: "l4", type: "DISCOUNT", code: "manual.discount", amount_cents: -211180, created_at: booked },
  ],
  settlement: null,
  damages: [],
  companyVehicle: false,
  owner: { investorId: "inv-dewr5s", eligible: true, revenueShareBps: 10000, shareBps: 7000, ledgerCents: 110084 },
};

const later = laMs("2027-01-20", "12:00");
const byKey = (items: PostingItem[]) => Object.fromEntries(items.map((entry) => [entry.source_key, entry]));
const amounts = (entry: PostingItem | undefined) => Object.fromEntries((entry?.targets ?? []).map((target) => [target.account, target.amount]));
const balanced = (items: PostingItem[]) => items.every((entry) => entry.targets.reduce((sum, target) => sum + target.amount, 0) === 0);

describe("orderTargets for MV-CRFBZ6", () => {
  it("recognizes the completed trip by month with the numbers from the plan", () => {
    const built = orderTargets(crfbz6, { mappings, now: later });
    const items = byKey(built.items);
    expect(Object.keys(items).sort()).toEqual(["order:res-crfbz6:own:2026-12", "order:res-crfbz6:own:2027-01", "order:res-crfbz6:rec:2026-12", "order:res-crfbz6:rec:2027-01"]);
    expect(amounts(items["order:res-crfbz6:rec:2026-12"])).toEqual({ "4010": -144260, "4020": -37277, "4930": 93715, "1100": 87822 });
    expect(amounts(items["order:res-crfbz6:rec:2027-01"])).toEqual({ "4010": -180820, "4020": -46723, "4930": 117465, "1100": 110078 });
    expect(items["order:res-crfbz6:rec:2026-12"].economic_date).toBe("2026-12-31");
    expect(items["order:res-crfbz6:rec:2027-01"].economic_date).toBe("2027-01-16");
    expect(amounts(items["order:res-crfbz6:own:2026-12"])).toEqual({ "5010": 48852, "2210": -48852 });
    expect(amounts(items["order:res-crfbz6:own:2027-01"])).toEqual({ "5010": 61232, "2210": -61232 });
    expect(balanced(built.items)).toBe(true);
    expect(built.issues).toEqual([]);
  });

  it("tags every line with the order, car and store, and owner lines with the owner", () => {
    const built = orderTargets(crfbz6, { mappings, now: later });
    for (const target of built.items.flatMap((entry) => entry.targets)) {
      expect(target).toMatchObject({ reservation_id: "res-crfbz6", vehicle_id: "veh-my111926", location_id: "loc-irvine" });
    }
    const rental = byKey(built.items)["order:res-crfbz6:rec:2026-12"].targets.find((target) => target.account === "4010");
    expect(rental?.revenue_class).toBe("RENTAL");
    const own = byKey(built.items)["order:res-crfbz6:own:2026-12"].targets;
    expect(own.every((target) => target.investor_id === "inv-dewr5s")).toBe(true);
  });

  it("customer account at the end of December is 87822, or a credit of 110078 after a full payment", () => {
    const december = amounts(byKey(orderTargets(crfbz6, { mappings, now: later }).items)["order:res-crfbz6:rec:2026-12"])["1100"];
    expect(december).toBe(87822);
    expect(december - 197900).toBe(-110078);
  });

  it("recognizes only finished days while the trip runs", () => {
    const running: OrderFacts = { ...crfbz6, status: "ACTIVE", actualReturnAt: null, completedAt: null };
    const built = orderTargets(running, { mappings, now: laMs("2026-12-25", "12:00") });
    const items = byKey(built.items);
    expect(Object.keys(items).sort()).toEqual(["order:res-crfbz6:own:2026-12", "order:res-crfbz6:rec:2026-12"]);
    expect(amounts(items["order:res-crfbz6:rec:2026-12"])).toEqual({ "4010": -61261, "4020": -15830, "4930": 39797, "1100": 37294 });
    expect(items["order:res-crfbz6:rec:2026-12"].economic_date).toBe("2026-12-24");
    expect(amounts(items["order:res-crfbz6:own:2026-12"])).toEqual({ "5010": 20745, "2210": -20745 });
  });

  it("posts nothing before pickup", () => {
    const confirmed: OrderFacts = { ...crfbz6, status: "CONFIRMED", actualPickupAt: null, actualReturnAt: null, completedAt: null };
    expect(orderTargets(confirmed, { mappings, now: laMs("2026-12-10", "12:00") })).toEqual({ items: [], issues: [] });
  });

  it("keeps the expected share and flags it when the owner ledger has nothing three days after completion", () => {
    const missing: OrderFacts = { ...crfbz6, owner: { ...crfbz6.owner!, ledgerCents: null } };
    const early = orderTargets(missing, { mappings, now: laMs("2027-01-18", "12:00") });
    expect(early.issues).toEqual([]);
    const late = orderTargets(missing, { mappings, now: laMs("2027-01-20", "12:00") });
    expect(late.issues).toEqual([{ kind: "share_missing", dedupeKey: "share_missing:res-crfbz6", reservationId: "res-crfbz6", investorId: "inv-dewr5s", detail: { number: "MV-CRFBZ6", expectedCents: 110084 } }]);
    expect(amounts(byKey(late.items)["order:res-crfbz6:own:2027-01"])["5010"]).toBe(61232);
  });

  it("trues the accrual up to the owner ledger at the return", () => {
    const adjusted: OrderFacts = { ...crfbz6, owner: { ...crfbz6.owner!, ledgerCents: 100000 } };
    const items = byKey(orderTargets(adjusted, { mappings, now: later }).items);
    expect(amounts(items["order:res-crfbz6:own:2026-12"])["5010"]).toBe(48852);
    expect(amounts(items["order:res-crfbz6:own:2027-01"])["5010"]).toBe(100000 - 48852);
  });

  it("accrues no share when the car is not on a revenue share today", () => {
    const off: OrderFacts = { ...crfbz6, owner: { ...crfbz6.owner!, eligible: false } };
    expect(orderTargets(off, { mappings, now: later }).items.filter((entry) => entry.source_key.includes(":own:"))).toEqual([]);
  });
});

describe("orderTargets for one-off items", () => {
  const base: OrderFacts = {
    ...crfbz6,
    id: "res-x",
    number: "MV-XXXXXX",
    owner: null,
    companyVehicle: true,
    lines: [
      { id: "a", type: "RENTAL", code: "rental.daily", amount_cents: 30000, created_at: booked },
      { id: "b", type: "DELIVERY", code: "fee.delivery", amount_cents: 4900, created_at: booked },
      { id: "c", type: "TAX", code: "tax.sales", amount_cents: 1234, created_at: booked },
      { id: "d", type: "ADD_ON", code: "addon.childSeat", amount_cents: 0, created_at: booked },
      { id: "e", type: "ADDITIONAL", code: "fee.late_return", amount_cents: 2500, created_at: "2027-01-16T16:00:00Z" },
      { id: "f", type: "ADDITIONAL", code: "fee.supercharging", amount_cents: 800, created_at: "2027-01-16T16:00:00Z" },
      { id: "g", type: "ADDITIONAL", code: "charge.toll", amount_cents: 1500, created_at: "2027-01-20T18:00:00Z" },
      { id: "h", type: "DISCOUNT", code: "manual.discount", amount_cents: -2000, created_at: "2027-01-18T20:00:00Z" },
      { id: "i", type: "FEE", code: "fee.airport", amount_cents: 1000, created_at: "2026-12-01T20:00:00Z" },
    ],
  };

  it("posts delivery and tax at pickup, fees at return, charges on their day and unknown codes to suspense", () => {
    const built = orderTargets(base, { mappings, now: laMs("2027-01-25", "12:00") });
    const items = byKey(built.items);
    expect(amounts(items["order:res-x:start"])).toEqual({ "4040": -4900, "2100": -1234, "1100": 6134 });
    expect(items["order:res-x:start"].economic_date).toBe("2026-12-19");
    expect(amounts(items["order:res-x:return"])).toEqual({ "4050": -2500, "4060": -800, "1100": 3300 });
    expect(items["order:res-x:return"].economic_date).toBe("2027-01-16");
    expect(amounts(items["order:res-x:addl:2027-01-20"])).toEqual({ "4060": -1500, "1100": 1500 });
    expect(amounts(items["order:res-x:addl:2027-01-18"])).toEqual({ "4930": 2000, "1100": -2000 });
    expect(amounts(items["order:res-x:addl:2026-12-01"])).toEqual({ "2900": -1000, "1100": 1000 });
    const spread = [items["order:res-x:rec:2026-12"], items["order:res-x:rec:2027-01"]].map((entry) => amounts(entry)["4010"]);
    expect(spread[0] + spread[1]).toBe(-30000);
    expect(built.items.some((entry) => entry.targets.some((target) => target.account === "4930" && entry.source_key.includes(":rec:")))).toBe(false);
    expect(built.issues).toEqual([{ kind: "unmapped_line", dedupeKey: "unmapped_line:res-x:FEE/fee.airport", reservationId: "res-x", detail: { number: "MV-XXXXXX", type: "FEE", code: "fee.airport", amountCents: 1000 } }]);
    expect(balanced(built.items)).toBe(true);
  });

  it("keeps the cancellation fee that was actually collected", () => {
    const cancelled: OrderFacts = { ...base, status: "CANCELLED", actualPickupAt: null, actualReturnAt: null, completedAt: null, cancelledAt: la("2026-12-15", "09:00"), lines: base.lines.slice(0, 3), settlement: { feeCents: 15000, uncollectedCents: 5000 } };
    const built = orderTargets(cancelled, { mappings, now: laMs("2026-12-16", "12:00") });
    expect(built.items.map((entry) => entry.source_key)).toEqual(["order:res-x:cancel"]);
    expect(amounts(built.items[0])).toEqual({ "4070": -10000, "1100": 10000 });
    expect(built.items[0].economic_date).toBe("2026-12-15");
    const nothingKept = orderTargets({ ...cancelled, status: "NO_SHOW", settlement: { feeCents: 3000, uncollectedCents: 5000 } }, { mappings, now: laMs("2026-12-16", "12:00") });
    expect(nothingKept.items).toEqual([]);
  });

  it("books damage on a company car as recovery and on an owner car to suspense", () => {
    const damage = { claimId: "claim-1", netCents: 45000, date: "2027-01-22" };
    const company = byKey(orderTargets({ ...base, damages: [damage] }, { mappings, now: later }).items)["order:res-x:damage:claim-1"];
    expect(amounts(company)).toEqual({ "4080": -45000, "1100": 45000 });
    expect(company.economic_date).toBe("2027-01-22");
    const owned = orderTargets({ ...base, companyVehicle: false, damages: [damage] }, { mappings, now: later });
    expect(amounts(byKey(owned.items)["order:res-x:damage:claim-1"])).toEqual({ "2900": -45000, "1100": 45000 });
    expect(owned.issues.map((issue) => issue.kind)).toContain("damage_owner_vehicle");
  });
});
