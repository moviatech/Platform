import { describe, expect, it } from "vitest";
import { pricingConfigSchema, type PricingConfig } from "./config";
import { buildQuote, QuoteError, rentalDays } from "./quote";

const config: PricingConfig = pricingConfigSchema.parse({
  rateTiers: [
    { id: "monthly", minDays: 30, multiplierBps: 5500 },
    { id: "weekly", minDays: 7, multiplierBps: 7500 },
    { id: "daily", minDays: 1, multiplierBps: 10000 },
  ],
  maxRentalDays: 90,
  minLeadHours: 2,
  bookingWindow: { start: "08:00", end: "20:00", stepMinutes: 30 },
  protectionChargeCapDays: 14,
  protectionPlans: [
    { id: "none", dailyCents: 0, monthlyCents: 0, deductibleCents: null },
    { id: "basic", dailyCents: 1900, monthlyCents: 27000, deductibleCents: 250000 },
    { id: "standard", dailyCents: 3200, monthlyCents: 45000, deductibleCents: 50000 },
    { id: "premier", dailyCents: 4500, monthlyCents: 63000, deductibleCents: 0 },
  ],
  addOns: [
    { id: "charging", kind: "perDay", priceCents: 990 },
    { id: "driver", kind: "perDay", priceCents: 500 },
    { id: "childSeat", kind: "free", depositCents: 10000 },
    { id: "unlimitedMiles", kind: "rentPercent", percentBps: 5000 },
  ],
  payNowDiscountBps: 200,
  youngDriver: { minAge: 21, maxAge: 24, feeDailyCents: 2500 },
  deliveryFeeCents: 0,
  returnGraceMinutes: 29,
  lateReturn: { notifiedFeeCents: 20000, unannouncedFeeCents: 50000 },
  holdRenewDays: 7,
  citationHoldCents: 20000,
  mileage: { allowance: { daily: 200, weekly: 1400, monthly: 6000 }, excessRateCents: { "model-y": 99, cybertruck: 149 } },
  charge: { minReturnLevel: 80, lowChargeFeeCentsPerPercent: 50 },
  cancelPolicy: {
    short: { freeHours: 24, lateDays: 1, noShowMaxDays: 3 },
    monthly: { freeHours: 72, feeHours: 48, feeCents: 10000, lateHours: 24, lateDays: 1, finalDays: 2, noShowDays: 3 },
  },
  requestHoldHours: 24,
  checkoutHoldMinutes: 30,
  tax: { protection: true, addOns: true, youngDriver: true, delivery: true, returnFees: false },
});

const round = (value: number) => Math.round(value * 100) / 100;

function websiteTotal(dailyRate: number, days: number, protection: string, addOns: string[], payNow: boolean) {
  const multiplier = days >= 30 ? 0.55 : days >= 7 ? 0.75 : 1;
  const rental = round(round(dailyRate * multiplier) * days);
  const plan = { none: [0, 0], basic: [19, 270], standard: [32, 450], premier: [45, 630] }[protection] as [number, number];
  const protectionAmount = days >= 30 ? round((plan[1] * days) / 30) : round(plan[0] * Math.min(days, 14));
  let extras = 0;
  if (addOns.includes("charging")) extras += round(9.9 * days);
  if (addOns.includes("driver")) extras += round(5 * days);
  if (addOns.includes("unlimitedMiles")) extras += round(rental * 0.5);
  const subtotal = round(rental + protectionAmount + extras);
  const discount = payNow ? round(subtotal * 0.02) : 0;
  const tax = round((subtotal - discount) * 0.0775);
  return Math.round(round(subtotal - discount + tax) * 100);
}

const base = {
  config,
  securityHoldCents: 50000,
  taxRateBps: 775,
  pickupDate: "2026-10-01",
  ageBand: "25_PLUS" as const,
  pickupMethod: "STORE" as const,
};

describe("rentalDays", () => {
  it("counts started 24h periods", () => {
    expect(rentalDays("2026-10-01", "10:00", "2026-10-05", "10:00")).toBe(4);
    expect(rentalDays("2026-10-01", "10:00", "2026-10-05", "10:30")).toBe(5);
    expect(rentalDays("2026-10-01", "10:00", "2026-10-01", "18:00")).toBe(1);
    expect(rentalDays("2026-10-05", "10:00", "2026-10-01", "10:00")).toBe(0);
  });
});

describe("buildQuote", () => {
  it("matches the public website totals within float rounding", () => {
    let compared = 0;
    let exact = 0;
    const rates = [99, 129, 179, 229];
    const lengths = [1, 3, 6, 7, 10, 14, 15, 29, 30, 45, 90];
    const protections = ["none", "basic", "standard", "premier"];
    const addOnSets = [[], ["charging"], ["driver", "childSeat"], ["unlimitedMiles"], ["charging", "driver", "unlimitedMiles"]];
    for (const rate of rates) {
      for (const days of lengths) {
        for (const protection of protections) {
          for (const addOns of addOnSets) {
            for (const payNow of [true, false]) {
              const quote = buildQuote({ ...base, baseDailyRateCents: rate * 100, days, protection, addOns, ratePlan: payNow ? "PAY_NOW" : "PAY_LATER" });
              const difference = Math.abs(quote.totalCents - websiteTotal(rate, days, protection, addOns, payNow));
              expect(difference, `${rate}/${days}/${protection}/${addOns.join("+")}/${payNow}`).toBeLessThanOrEqual(2);
              compared += 1;
              if (difference === 0) exact += 1;
            }
          }
        }
      }
    }
    expect(exact / compared).toBeGreaterThan(0.97);
  });

  it("keeps lines consistent with totals", () => {
    const quote = buildQuote({ ...base, baseDailyRateCents: 12900, days: 4, protection: "standard", addOns: ["charging", "childSeat"], ratePlan: "PAY_NOW" });
    const sum = quote.lines.reduce((total, line) => total + line.amountCents, 0);
    expect(sum).toBe(quote.totalCents);
    expect(quote.depositCents).toBe(10000);
    expect(quote.securityHoldCents).toBe(50000);
  });

  it("adds the young driver fee and delivery fee when applicable", () => {
    const adult = buildQuote({ ...base, baseDailyRateCents: 9900, days: 3, protection: "none", addOns: [], ratePlan: "PAY_LATER" });
    const young = buildQuote({ ...base, ageBand: "21_24", baseDailyRateCents: 9900, days: 3, protection: "none", addOns: [], ratePlan: "PAY_LATER" });
    expect(young.subtotalCents - adult.subtotalCents).toBe(7500);
    const delivered = buildQuote({ ...base, config: { ...config, deliveryFeeCents: 4900 }, pickupMethod: "DELIVERY", baseDailyRateCents: 9900, days: 3, protection: "none", addOns: [], ratePlan: "PAY_LATER" });
    expect(delivered.subtotalCents - adult.subtotalCents).toBe(4900);
  });

  it("applies date overrides per day", () => {
    const quote = buildQuote({
      ...base,
      baseDailyRateCents: 10000,
      days: 3,
      protection: "none",
      addOns: [],
      ratePlan: "PAY_LATER",
      overrides: [{ dateFrom: "2026-10-02", dateTo: "2026-10-02", dailyRateCents: 15000 }],
    });
    expect(quote.subtotalCents).toBe(35000);
  });

  it("rejects invalid input", () => {
    expect(() => buildQuote({ ...base, baseDailyRateCents: 9900, days: 91, protection: "none", addOns: [], ratePlan: "PAY_NOW" })).toThrow(QuoteError);
    expect(() => buildQuote({ ...base, baseDailyRateCents: 9900, days: 2, protection: "gold", addOns: [], ratePlan: "PAY_NOW" })).toThrow(QuoteError);
    expect(() => buildQuote({ ...base, baseDailyRateCents: 9900, days: 2, protection: "none", addOns: ["jetpack"], ratePlan: "PAY_NOW" })).toThrow(QuoteError);
  });
});
