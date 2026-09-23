import type { AgeBand, PickupMethod, PricingConfig, RatePlan } from "./config";

export type QuoteLineType = "RENTAL" | "PROTECTION" | "ADD_ON" | "DELIVERY" | "YOUNG_DRIVER" | "DISCOUNT" | "TAX";

export type QuoteLine = {
  type: QuoteLineType;
  code: string;
  description: string;
  quantity: number;
  unitCents: number;
  amountCents: number;
  taxable: boolean;
};

export type RateOverride = { dateFrom: string; dateTo: string; dailyRateCents: number };

export type CouponTerms = {
  id: string;
  code: string;
  kind: "PERCENT" | "AMOUNT";
  percentBps: number;
  amountCents: number;
  maxDiscountCents: number | null;
  stackable: boolean;
  bearer: "COMPANY" | "SHARED";
};

export type AppliedCoupon = CouponTerms & { discountCents: number };

export const couponLineCode = (bearer: CouponTerms["bearer"]) => (bearer === "COMPANY" ? "discount.coupon_company" : "discount.coupon");
export const isCouponLine = (code: string) => code === "discount.coupon" || code === "discount.coupon_company";

export function couponAmount(coupon: Pick<CouponTerms, "kind" | "percentBps" | "amountCents" | "maxDiscountCents">, rentalCents: number) {
  const raw = coupon.kind === "PERCENT" ? Math.round((rentalCents * coupon.percentBps) / 10000) : coupon.amountCents;
  return Math.max(0, Math.min(rentalCents, raw, coupon.maxDiscountCents ?? raw));
}

export function settleDiscounts(input: { subtotalCents: number; taxableCents: number; couponCents: number; couponStackable: boolean; payNow: boolean; payNowBps: number; taxRateBps: number }) {
  const couponCents = Math.max(0, Math.min(input.couponCents, input.taxableCents, input.subtotalCents));
  const afterCoupon = input.subtotalCents - couponCents;
  const taxableAfter = input.taxableCents - couponCents;
  const payNowCents = input.payNow && (couponCents === 0 || input.couponStackable) ? Math.round((afterCoupon * input.payNowBps) / 10000) : 0;
  const payNowOnTaxable = afterCoupon > 0 ? Math.round((payNowCents * taxableAfter) / afterCoupon) : 0;
  const taxableCents = Math.max(0, taxableAfter - payNowOnTaxable);
  const taxCents = taxAt(taxableCents, input.taxRateBps);
  return { couponCents, payNowCents, taxableCents, taxCents, totalCents: afterCoupon - payNowCents + taxCents };
}

export const taxAt = (taxableCents: number, taxRateBps: number) => Math.round((taxableCents * taxRateBps) / 10000);

export const ratePercent = (taxRateBps: number) => `${Number((taxRateBps / 100).toFixed(3))}%`;

const quotedTypes = ["RENTAL", "PROTECTION", "ADD_ON", "YOUNG_DRIVER", "DELIVERY", "FEE"];

export type PricedLine = { type: string; code: string; amount_cents: number; taxable: boolean };

export const isQuotedLine = (line: Pick<PricedLine, "type" | "code">) => quotedTypes.includes(line.type) && !line.code.startsWith("manual.");

export function settleLines(lines: PricedLine[], input: { payNow: boolean; payNowBps: number; couponStackable: boolean; taxRateBps: number }) {
  const quoted = lines.filter(isQuotedLine);
  const subtotalCents = quoted.reduce((sum, line) => sum + line.amount_cents, 0);
  const gross = quoted.filter((line) => line.taxable).reduce((sum, line) => sum + line.amount_cents, 0);
  const coupon = -lines.filter((line) => isCouponLine(line.code)).reduce((sum, line) => sum + line.amount_cents, 0);
  return { subtotalCents, ...settleDiscounts({ subtotalCents, taxableCents: gross, couponCents: coupon, couponStackable: input.couponStackable, payNow: input.payNow, payNowBps: input.payNowBps, taxRateBps: input.taxRateBps }) };
}

export type QuoteInput = {
  config: PricingConfig;
  baseDailyRateCents: number;
  securityHoldCents: number;
  taxRateBps: number;
  pickupDate: string;
  days: number;
  protection: string;
  addOns: string[];
  ratePlan: RatePlan;
  ageBand: AgeBand;
  pickupMethod: PickupMethod;
  extraDrivers?: number;
  spouseDriver?: boolean;
  overrides?: RateOverride[];
  coupon?: CouponTerms | null;
  model?: string | null;
};

export type Quote = {
  days: number;
  tier: string;
  multiplierBps: number;
  averageDailyCents: number;
  lines: QuoteLine[];
  subtotalCents: number;
  discountCents: number;
  taxCents: number;
  taxableCents: number;
  taxRateBps: number;
  totalCents: number;
  securityHoldCents: number;
  depositCents: number;
  currency: "usd";
  coupon?: AppliedCoupon | null;
};

export class QuoteError extends Error {}

export const applyBps = (amount: number, bps: number) => Math.round((amount * bps) / 10000);

export const minimumChargeCents = 50;

export function rentalDays(startDate: string, startTime: string, endDate: string, endTime: string) {
  const [sy, sm, sd] = startDate.split("-").map(Number);
  const [ey, em, ed] = endDate.split("-").map(Number);
  const [sh, smin] = startTime.split(":").map(Number);
  const [eh, emin] = endTime.split(":").map(Number);
  const minutes = (Date.UTC(ey, em - 1, ed, eh, emin) - Date.UTC(sy, sm - 1, sd, sh, smin)) / 60000;
  return minutes <= 0 ? 0 : Math.max(1, Math.ceil(minutes / 1440));
}

function addDaysIso(date: string, offset: number) {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + offset)).toISOString().slice(0, 10);
}

export function waiverDailyCents(config: Pick<PricingConfig, "protectionPlans" | "protectionSurchargeCents">, planId: string, model?: string | null) {
  const plan = config.protectionPlans.find((item) => item.id === planId);
  if (!plan || plan.dailyCents <= 0) return 0;
  return plan.dailyCents + (config.protectionSurchargeCents[model ?? ""] ?? 0);
}

export function excessRateFor(snapshot: Record<string, number> | null | undefined, configured: Record<string, number>, model: string) {
  return snapshot?.[model] ?? configured[model] ?? 0;
}

export function tierFor(config: PricingConfig, days: number) {
  const sorted = [...config.rateTiers].sort((a, b) => b.minDays - a.minDays);
  return sorted.find((tier) => days >= tier.minDays) ?? sorted[sorted.length - 1];
}

export function buildQuote(input: QuoteInput): Quote {
  const { config, days } = input;
  if (!Number.isInteger(days) || days < 1) throw new QuoteError("invalid_days");
  if (days > config.maxRentalDays) throw new QuoteError("too_long");

  const plan = config.protectionPlans.find((item) => item.id === input.protection);
  if (!plan) throw new QuoteError("invalid_protection");
  const selected = config.addOns.filter((item) => input.addOns.includes(item.id));
  if (selected.length !== new Set(input.addOns).size) throw new QuoteError("invalid_add_on");

  const tier = tierFor(config, days);
  let rentalCents = 0;
  for (let i = 0; i < days; i++) {
    const date = addDaysIso(input.pickupDate, i);
    const override = input.overrides?.find((item) => date >= item.dateFrom && date <= item.dateTo);
    rentalCents += applyBps(override?.dailyRateCents ?? input.baseDailyRateCents, tier.multiplierBps);
  }
  const averageDailyCents = Math.round(rentalCents / days);

  const lines: QuoteLine[] = [
    { type: "RENTAL", code: `rental.${tier.id}`, description: `Rental · ${days} day(s)`, quantity: days, unitCents: averageDailyCents, amountCents: rentalCents, taxable: true },
  ];

  const waiverDaily = waiverDailyCents(config, plan.id, input.model);
  const protectionCents = waiverDaily * days;
  if (protectionCents > 0) {
    lines.push({
      type: "PROTECTION",
      code: `protection.${plan.id}`,
      description: `Protection · ${plan.id}`,
      quantity: days,
      unitCents: waiverDaily,
      amountCents: protectionCents,
      taxable: config.tax.protection,
    });
  }

  let depositCents = 0;
  for (const item of selected) {
    if (item.kind === "perDay") {
      const count = item.id === "driver" ? Math.max(1, input.extraDrivers ?? 1) : 1;
      const billable = item.id === "driver" && input.spouseDriver ? count - 1 : count;
      lines.push({
        type: "ADD_ON",
        code: `addon.${item.id}`,
        description: `Add-on · ${item.id}${count > 1 ? ` × ${count}` : ""}${billable < count ? " · spouse free" : ""}`,
        quantity: days * Math.max(1, billable),
        unitCents: billable > 0 ? item.priceCents : 0,
        amountCents: item.priceCents * days * billable,
        taxable: config.tax.addOns,
      });
    } else if (item.kind === "rentPercent") {
      const amount = applyBps(rentalCents, item.percentBps);
      lines.push({ type: "ADD_ON", code: `addon.${item.id}`, description: `Add-on · ${item.id}`, quantity: 1, unitCents: amount, amountCents: amount, taxable: config.tax.addOns });
    } else {
      depositCents += item.depositCents ?? 0;
      lines.push({ type: "ADD_ON", code: `addon.${item.id}`, description: `Add-on · ${item.id}`, quantity: 1, unitCents: 0, amountCents: 0, taxable: false });
    }
  }

  if (input.ageBand === "21_24" && config.youngDriver.feeDailyCents > 0) {
    lines.push({
      type: "YOUNG_DRIVER",
      code: "fee.young_driver",
      description: "Young driver fee",
      quantity: days,
      unitCents: config.youngDriver.feeDailyCents,
      amountCents: config.youngDriver.feeDailyCents * days,
      taxable: config.tax.youngDriver,
    });
  }

  if (input.pickupMethod === "DELIVERY" && config.deliveryFeeCents > 0) {
    lines.push({ type: "DELIVERY", code: "fee.delivery", description: "Delivery", quantity: 1, unitCents: config.deliveryFeeCents, amountCents: config.deliveryFeeCents, taxable: config.tax.delivery });
  }

  const subtotalCents = lines.reduce((sum, line) => sum + line.amountCents, 0);
  const taxableCents = lines.filter((line) => line.taxable).reduce((sum, line) => sum + line.amountCents, 0);
  const payNow = input.ratePlan === "PAY_NOW";
  const coupon = input.coupon ?? null;
  const wanted = coupon ? couponAmount(coupon, rentalCents) : 0;
  if (coupon && !coupon.stackable) {
    if (tier.multiplierBps < 10000) throw new QuoteError("coupon_not_combinable");
    if (payNow && applyBps(subtotalCents, config.payNowDiscountBps) >= wanted) throw new QuoteError("coupon_not_combinable");
  }
  const settled = settleDiscounts({ subtotalCents, taxableCents, couponCents: wanted, couponStackable: coupon?.stackable ?? true, payNow, payNowBps: config.payNowDiscountBps, taxRateBps: input.taxRateBps });
  const couponCents = settled.couponCents;
  if (coupon && couponCents > 0) {
    lines.push({ type: "DISCOUNT", code: couponLineCode(coupon.bearer), description: `Coupon ${coupon.code}`, quantity: 1, unitCents: -couponCents, amountCents: -couponCents, taxable: true });
  }
  if (settled.payNowCents > 0) {
    lines.push({ type: "DISCOUNT", code: "discount.pay_now", description: "Pay now discount", quantity: 1, unitCents: -settled.payNowCents, amountCents: -settled.payNowCents, taxable: true });
  }
  const discountCents = couponCents + settled.payNowCents;
  const taxCents = settled.taxCents;
  if (taxCents > 0) {
    lines.push({ type: "TAX", code: "tax.sales", description: "Sales tax", quantity: 1, unitCents: taxCents, amountCents: taxCents, taxable: false });
  }

  return {
    days,
    tier: tier.id,
    multiplierBps: tier.multiplierBps,
    averageDailyCents,
    lines,
    subtotalCents,
    discountCents,
    taxCents,
    taxableCents: settled.taxableCents,
    taxRateBps: input.taxRateBps,
    totalCents: subtotalCents - discountCents + taxCents,
    securityHoldCents: input.securityHoldCents,
    depositCents,
    currency: "usd",
    coupon: coupon && couponCents > 0 ? { ...coupon, discountCents: couponCents } : null,
  };
}
