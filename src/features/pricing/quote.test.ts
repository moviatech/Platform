import { describe, expect, it } from "vitest";
import { pricingConfigSchema, type PricingConfig } from "./config";
import { buildQuote, couponAmount, excessRateFor, QuoteError, ratePercent, rentalDays, settleDiscounts, settleLines, taxAt, waiverDailyCents, type CouponTerms, type Quote } from "./quote";

const config: PricingConfig = pricingConfigSchema.parse({
  rateTiers: [
    { id: "monthly", minDays: 30, multiplierBps: 7500 },
    { id: "weekly", minDays: 7, multiplierBps: 9000 },
    { id: "daily", minDays: 1, multiplierBps: 10000 },
  ],
  maxRentalDays: 90,
  minLeadHours: 2,
  bookingWindow: { start: "08:00", end: "20:00", stepMinutes: 30 },
  protectionPlans: [
    { id: "none", dailyCents: 0, deductibleCents: null },
    { id: "basic", dailyCents: 2000, deductibleCents: 200000 },
    { id: "standard", dailyCents: 3000, deductibleCents: 50000 },
    { id: "premier", dailyCents: 4000, deductibleCents: 0 },
  ],
  protectionSurchargeCents: { cybertruck: 500 },
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
  lateReturn: { hourlyCapHours: 5 },
  holdRenewDays: 7,
  citationHoldCents: 20000,
  mileage: { allowance: { daily: 150, weekly: 1050, monthly: 4500 }, excessRateCents: { "model-3": 80, "model-y": 80, cybertruck: 120 } },
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
  const multiplier = days >= 30 ? 0.75 : days >= 7 ? 0.9 : 1;
  const rental = round(round(dailyRate * multiplier) * days);
  const plan = { none: 0, basic: 20, standard: 30, premier: 40 }[protection] as number;
  const protectionAmount = round(plan * days);
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

  it("prices weekly rentals at 90% and monthly rentals at 75% of the daily rate", () => {
    const week = buildQuote({ ...base, baseDailyRateCents: 10000, days: 7, protection: "none", addOns: [], ratePlan: "PAY_LATER" });
    const month = buildQuote({ ...base, baseDailyRateCents: 10000, days: 30, protection: "none", addOns: [], ratePlan: "PAY_LATER" });
    expect(week.subtotalCents).toBe(63000);
    expect(month.subtotalCents).toBe(225000);
  });

  it("charges the waiver for every rental day with no cap and no monthly price", () => {
    const price = (days: number, protection: string) => buildQuote({ ...base, baseDailyRateCents: 10000, days, protection, addOns: [], ratePlan: "PAY_LATER" }).lines.find((line) => line.type === "PROTECTION");
    expect(price(14, "basic")?.amountCents).toBe(28000);
    expect(price(20, "basic")?.amountCents).toBe(40000);
    expect(price(30, "basic")?.amountCents).toBe(60000);
    expect(price(30, "standard")?.amountCents).toBe(90000);
    expect(price(45, "premier")?.amountCents).toBe(180000);
    expect(price(20, "basic")?.unitCents).toBe(2000);
    expect(price(20, "basic")?.quantity).toBe(20);
  });

  it("adds the per-day Cybertruck surcharge to every paid waiver plan and to nothing else", () => {
    const waiver = (model: string, protection: string) => buildQuote({ ...base, model, baseDailyRateCents: 10000, days: 3, protection, addOns: [], ratePlan: "PAY_LATER" }).lines.find((line) => line.type === "PROTECTION");
    expect(waiver("cybertruck", "basic")?.amountCents).toBe(7500);
    expect(waiver("cybertruck", "standard")?.unitCents).toBe(3500);
    expect(waiver("cybertruck", "premier")?.amountCents).toBe(13500);
    expect(waiver("cybertruck", "none")).toBeUndefined();
    expect(waiver("model-y", "basic")?.amountCents).toBe(6000);
    expect(waiver("model-3", "premier")?.amountCents).toBe(12000);
    expect(waiverDailyCents(config, "basic", "cybertruck")).toBe(2500);
    expect(waiverDailyCents(config, "none", "cybertruck")).toBe(0);
    expect(waiverDailyCents(config, "basic")).toBe(2000);
  });

  it("rejects invalid input", () => {
    expect(() => buildQuote({ ...base, baseDailyRateCents: 9900, days: 91, protection: "none", addOns: [], ratePlan: "PAY_NOW" })).toThrow(QuoteError);
    expect(() => buildQuote({ ...base, baseDailyRateCents: 9900, days: 2, protection: "gold", addOns: [], ratePlan: "PAY_NOW" })).toThrow(QuoteError);
    expect(() => buildQuote({ ...base, baseDailyRateCents: 9900, days: 2, protection: "none", addOns: ["jetpack"], ratePlan: "PAY_NOW" })).toThrow(QuoteError);
  });
});

const coupon = (patch: Partial<CouponTerms> = {}): CouponTerms => ({ id: "c1", code: "SAVE10", kind: "PERCENT", percentBps: 1000, amountCents: 0, maxDiscountCents: null, stackable: true, bearer: "COMPANY", ...patch });
const trip = { ...base, baseDailyRateCents: 10000, days: 3, protection: "standard", addOns: [] as string[] };

describe("coupons", () => {
  it("takes a percentage off the rent only, before tax", () => {
    const plain = buildQuote({ ...trip, ratePlan: "PAY_LATER" });
    const quote = buildQuote({ ...trip, ratePlan: "PAY_LATER", coupon: coupon() });
    expect(quote.coupon?.discountCents).toBe(3000);
    expect(quote.subtotalCents).toBe(plain.subtotalCents);
    expect(quote.taxCents).toBe(Math.round((plain.subtotalCents - 3000) * 0.0775));
    expect(quote.totalCents).toBe(plain.subtotalCents - 3000 + quote.taxCents);
    expect(quote.lines.reduce((sum, line) => sum + line.amountCents, 0)).toBe(quote.totalCents);
    expect(quote.lines.find((line) => line.code === "discount.coupon_company")?.amountCents).toBe(-3000);
  });

  it("marks who pays for it in the line code", () => {
    const quote = buildQuote({ ...trip, ratePlan: "PAY_LATER", coupon: coupon({ bearer: "SHARED" }) });
    expect(quote.lines.some((line) => line.code === "discount.coupon")).toBe(true);
    expect(quote.coupon?.bearer).toBe("SHARED");
  });

  it("never takes more than the rent or the cap", () => {
    expect(couponAmount(coupon({ kind: "AMOUNT", amountCents: 50000 }), 30000)).toBe(30000);
    expect(couponAmount(coupon({ percentBps: 5000, maxDiscountCents: 4000 }), 30000)).toBe(4000);
    expect(couponAmount(coupon({ kind: "AMOUNT", amountCents: 2500 }), 30000)).toBe(2500);
  });

  it("stacks with the pay-now discount when allowed, applying pay-now to what is left", () => {
    const quote = buildQuote({ ...trip, ratePlan: "PAY_NOW", coupon: coupon() });
    const payNow = Math.round((quote.subtotalCents - 3000) * 0.02);
    expect(quote.lines.find((line) => line.code === "discount.pay_now")?.amountCents).toBe(-payNow);
    expect(quote.discountCents).toBe(3000 + payNow);
    expect(quote.totalCents).toBe(quote.subtotalCents - 3000 - payNow + quote.taxCents);
  });

  it("stacks with weekly rates when allowed", () => {
    const quote = buildQuote({ ...trip, days: 7, ratePlan: "PAY_LATER", coupon: coupon() });
    expect(quote.coupon?.discountCents).toBe(6300);
  });

  it("refuses a non-stackable coupon on weekly or monthly rates", () => {
    expect(() => buildQuote({ ...trip, days: 7, ratePlan: "PAY_LATER", coupon: coupon({ stackable: false }) })).toThrow("coupon_not_combinable");
    expect(() => buildQuote({ ...trip, days: 30, ratePlan: "PAY_LATER", coupon: coupon({ stackable: false }) })).toThrow("coupon_not_combinable");
  });

  it("lets a non-stackable coupon replace the pay-now discount only when it is worth more", () => {
    const quote = buildQuote({ ...trip, ratePlan: "PAY_NOW", coupon: coupon({ stackable: false }) });
    expect(quote.lines.some((line) => line.code === "discount.pay_now")).toBe(false);
    expect(quote.discountCents).toBe(3000);
    expect(() => buildQuote({ ...trip, ratePlan: "PAY_NOW", coupon: coupon({ stackable: false, kind: "AMOUNT", amountCents: 500 }) })).toThrow("coupon_not_combinable");
  });

  it("leaves the quote unchanged without a coupon", () => {
    const before = buildQuote({ ...trip, ratePlan: "PAY_NOW" });
    const after = buildQuote({ ...trip, ratePlan: "PAY_NOW", coupon: null });
    expect(after).toEqual(before);
    expect(before.coupon).toBeNull();
  });
});

describe("excessRateFor", () => {
  it("prefers the terms stored on the order, then the configuration, then charges nothing", () => {
    expect(excessRateFor({ "model-y": 99 }, config.mileage.excessRateCents, "model-y")).toBe(99);
    expect(excessRateFor({ "model-y": 99 }, config.mileage.excessRateCents, "cybertruck")).toBe(120);
    expect(excessRateFor(undefined, config.mileage.excessRateCents, "model-3")).toBe(80);
    expect(excessRateFor(null, config.mileage.excessRateCents, "roadster")).toBe(0);
  });
});

describe("settleDiscounts", () => {
  it("recomputes pay-now and tax around an existing coupon", () => {
    const settled = settleDiscounts({ subtotalCents: 40000, taxableCents: 40000, couponCents: 3000, couponStackable: true, payNow: true, payNowBps: 200, taxRateBps: 775 });
    expect(settled).toEqual({ couponCents: 3000, payNowCents: 740, taxableCents: 36260, taxCents: Math.round(36260 * 0.0775), totalCents: 36260 + Math.round(36260 * 0.0775) });
  });

  it("drops the pay-now discount for a non-stackable coupon", () => {
    const settled = settleDiscounts({ subtotalCents: 40000, taxableCents: 40000, couponCents: 3000, couponStackable: false, payNow: true, payNowBps: 200, taxRateBps: 775 });
    expect(settled.payNowCents).toBe(0);
    expect(settled.taxCents).toBe(Math.round(37000 * 0.0775));
  });
});

describe("tax base and rate", () => {
  const asLines = (quote: Quote) => quote.lines.map((line) => ({ type: line.type, code: line.code, amount_cents: line.amountCents, taxable: line.taxable }));
  const exempt: typeof config = { ...config, tax: { ...config.tax, protection: false } };
  const coupon: CouponTerms = { id: "c1", code: "TEN", kind: "PERCENT", percentBps: 1000, amountCents: 0, maxDiscountCents: null, stackable: true, bearer: "COMPANY" };

  it("records the taxed amount and the rate on the quote", () => {
    const quote = buildQuote({ ...base, baseDailyRateCents: 10000, days: 4, protection: "standard", addOns: [], ratePlan: "PAY_LATER" });
    expect(quote.taxRateBps).toBe(775);
    expect(quote.taxableCents).toBe(52000);
    expect(quote.taxCents).toBe(taxAt(52000, 775));
  });

  it("leaves untaxed lines and their share of the pay-now discount out of the taxed amount", () => {
    const quote = buildQuote({ ...base, config: exempt, baseDailyRateCents: 10000, days: 4, protection: "standard", addOns: [], ratePlan: "PAY_NOW" });
    expect(quote.subtotalCents).toBe(52000);
    expect(quote.taxableCents).toBe(40000 - 800);
    expect(quote.taxCents).toBe(taxAt(39200, 775));
    expect(quote.totalCents).toBe(52000 - 1040 + quote.taxCents);
  });

  it("supports rates with three decimals", () => {
    const quote = buildQuote({ ...base, taxRateBps: 937.5, baseDailyRateCents: 12900, days: 3, protection: "none", addOns: [], ratePlan: "PAY_LATER" });
    expect(quote.taxCents).toBe(Math.round(38700 * 0.09375));
    expect(ratePercent(937.5)).toBe("9.375%");
    expect(ratePercent(775)).toBe("7.75%");
    expect(ratePercent(1025)).toBe("10.25%");
    expect(ratePercent(0)).toBe("0%");
  });

  it("re-derives the same figures from stored lines", () => {
    for (const ratePlan of ["PAY_NOW", "PAY_LATER"] as const) {
      for (const rules of [config, exempt]) {
        for (const applied of [null, coupon]) {
          const quote = buildQuote({ ...base, config: rules, taxRateBps: 937.5, baseDailyRateCents: 13700, days: 9, protection: "premier", addOns: ["charging", "driver"], ratePlan, coupon: applied, pickupMethod: "STORE" });
          const settled = settleLines(asLines(quote), { payNow: ratePlan === "PAY_NOW", payNowBps: rules.payNowDiscountBps, couponStackable: true, taxRateBps: 937.5 });
          expect(settled.subtotalCents).toBe(quote.subtotalCents);
          expect(settled.taxableCents).toBe(quote.taxableCents);
          expect(settled.taxCents).toBe(quote.taxCents);
          expect(settled.couponCents + settled.payNowCents).toBe(quote.discountCents);
          expect(settled.totalCents).toBe(quote.totalCents);
        }
      }
    }
  });

  it("ignores manual and post-rental lines when settling", () => {
    const quote = buildQuote({ ...base, baseDailyRateCents: 10000, days: 2, protection: "none", addOns: [], ratePlan: "PAY_NOW" });
    const extra = [
      { type: "DISCOUNT", code: "manual.discount", amount_cents: -3000, taxable: false },
      { type: "ADDITIONAL", code: "manual.fee", amount_cents: 1500, taxable: false },
      { type: "ADDITIONAL", code: "charge.toll", amount_cents: 900, taxable: false },
    ];
    const settled = settleLines([...asLines(quote), ...extra], { payNow: true, payNowBps: config.payNowDiscountBps, couponStackable: true, taxRateBps: 775 });
    expect(settled.subtotalCents).toBe(20000);
    expect(settled.taxableCents).toBe(19600);
    expect(settled.totalCents).toBe(quote.totalCents);
  });
});

describe("spouse as an additional driver", () => {
  const input = { ...base, baseDailyRateCents: 10000, days: 3, protection: "none", addOns: ["driver"], ratePlan: "PAY_LATER" as const };
  const driverLine = (quote: Quote) => quote.lines.find((line) => line.code === "addon.driver");

  it("charges each additional driver when none is a spouse", () => {
    expect(driverLine(buildQuote({ ...input, extraDrivers: 1 }))?.amountCents).toBe(1500);
    expect(driverLine(buildQuote({ ...input, extraDrivers: 2 }))?.amountCents).toBe(3000);
  });

  it("keeps the line at no charge for a spouse alone", () => {
    const free = buildQuote({ ...input, extraDrivers: 1, spouseDriver: true });
    expect(driverLine(free)).toMatchObject({ amountCents: 0, unitCents: 0, quantity: 3 });
    expect(free.totalCents).toBe(buildQuote({ ...input, addOns: [] }).totalCents);
  });

  it("takes exactly one driver off the bill when a spouse is among several", () => {
    const two = buildQuote({ ...input, extraDrivers: 2, spouseDriver: true });
    expect(driverLine(two)).toMatchObject({ amountCents: 1500, unitCents: 500, quantity: 3 });
    const three = buildQuote({ ...input, extraDrivers: 3, spouseDriver: true });
    expect(driverLine(three)?.amountCents).toBe(3000);
    expect(three.lines.reduce((total, line) => total + line.amountCents, 0)).toBe(three.totalCents);
  });

  it("ignores the spouse flag when no driver is added", () => {
    const none = buildQuote({ ...input, addOns: [], spouseDriver: true });
    expect(driverLine(none)).toBeUndefined();
  });
});
