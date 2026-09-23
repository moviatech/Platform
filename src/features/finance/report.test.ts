import { describe, expect, it } from "vitest";
import { buildStatement, isMonth, lineGroup, monthRange, netOfTax, shiftMonth } from "./report";

const lines = [
  { type: "RENTAL", code: "rental.daily", amount_cents: 60000 },
  { type: "PROTECTION", code: "protection.standard", amount_cents: 9600 },
  { type: "ADD_ON", code: "addon.charging", amount_cents: 2970 },
  { type: "YOUNG_DRIVER", code: "fee.young", amount_cents: 4500 },
  { type: "DELIVERY", code: "delivery", amount_cents: 4500 },
  { type: "DISCOUNT", code: "discount.paynow", amount_cents: -1200 },
  { type: "TAX", code: "tax.sales", amount_cents: 6200 },
  { type: "ADDITIONAL", code: "fee.late", amount_cents: 5000 },
  { type: "ADDITIONAL", code: "fee.tax", amount_cents: 388 },
];

describe("months", () => {
  it("validates and shifts across years", () => {
    expect(isMonth("2026-10")).toBe(true);
    expect(isMonth("2026-13")).toBe(false);
    expect(isMonth("2026-1")).toBe(false);
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
  });

  it("knows the last day of a month", () => {
    expect(monthRange("2026-02")).toEqual({ from: "2026-02-01", to: "2026-02-28", days: 28 });
    expect(monthRange("2028-02").to).toBe("2028-02-29");
    expect(monthRange("2026-10").days).toBe(31);
  });
});

describe("lineGroup", () => {
  it("treats the tax on post-rental charges as tax, not income", () => {
    expect(lineGroup({ type: "ADDITIONAL", code: "fee.tax" })).toBe("TAX");
    expect(lineGroup({ type: "ADDITIONAL", code: "fee.late" })).toBe("POST_RENTAL");
  });

  it("puts unknown line types under fees", () => {
    expect(lineGroup({ type: "FEE", code: "fee.airport" })).toBe("FEES");
    expect(lineGroup({ type: "SOMETHING", code: "x" })).toBe("FEES");
  });
});

describe("buildStatement", () => {
  it("separates income by kind, keeps tax out and subtracts owner pay and costs", () => {
    const statement = buildStatement({
      lines,
      cancellationCents: 5000,
      payableCents: 36000,
      costs: [
        { category: "CHARGING", amountCents: 4200 },
        { category: "MAINTENANCE", amountCents: 18000 },
        { category: "SERVICE", amountCents: 9500 },
      ],
    });
    expect(statement.revenue).toEqual({ RENTAL: 60000, PROTECTION: 9600, ADD_ONS: 7470, FEES: 4500, POST_RENTAL: 5000, DISCOUNT: -1200, CANCELLATION: 5000 });
    expect(statement.revenueCents).toBe(90370);
    expect(statement.taxCents).toBe(6588);
    expect(statement.grossCents).toBe(54370);
    expect(statement.costs.MAINTENANCE).toBe(18000);
    expect(statement.costs.SERVICE).toBe(9500);
    expect(statement.costCents).toBe(31700);
    expect(statement.profitCents).toBe(22670);
  });

  it("is all zeros for an empty month", () => {
    const statement = buildStatement({ lines: [], cancellationCents: 0, payableCents: 0, costs: [] });
    expect(statement.revenueCents).toBe(0);
    expect(statement.profitCents).toBe(0);
    expect(statement.costs.OTHER).toBe(0);
  });

  it("can show a loss", () => {
    expect(buildStatement({ lines: [{ type: "RENTAL", code: "rental.daily", amount_cents: 10000 }], cancellationCents: 0, payableCents: 6000, costs: [{ category: "INSURANCE", amountCents: 9000 }] }).profitCents).toBe(-5000);
  });
});

describe("netOfTax", () => {
  it("sums everything except tax lines", () => {
    expect(netOfTax(lines)).toBe(85370);
  });
});
