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
  overrides?: RateOverride[];
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
  totalCents: number;
  securityHoldCents: number;
  depositCents: number;
  currency: "usd";
};

export class QuoteError extends Error {}

const applyBps = (amount: number, bps: number) => Math.round((amount * bps) / 10000);

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

  const protectionCents =
    days >= 30 ? Math.round((plan.monthlyCents * days) / 30) : plan.dailyCents * Math.min(days, config.protectionChargeCapDays);
  if (protectionCents > 0) {
    lines.push({
      type: "PROTECTION",
      code: `protection.${plan.id}`,
      description: `Protection · ${plan.id}`,
      quantity: days,
      unitCents: Math.round(protectionCents / days),
      amountCents: protectionCents,
      taxable: config.tax.protection,
    });
  }

  let depositCents = 0;
  for (const item of selected) {
    if (item.kind === "perDay") {
      lines.push({ type: "ADD_ON", code: `addon.${item.id}`, description: `Add-on · ${item.id}`, quantity: days, unitCents: item.priceCents, amountCents: item.priceCents * days, taxable: config.tax.addOns });
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
  const discountCents = input.ratePlan === "PAY_NOW" ? applyBps(subtotalCents, config.payNowDiscountBps) : 0;
  if (discountCents > 0) {
    lines.push({ type: "DISCOUNT", code: "discount.pay_now", description: "Pay now discount", quantity: 1, unitCents: -discountCents, amountCents: -discountCents, taxable: true });
  }
  const taxableCents = lines.filter((line) => line.taxable && line.type !== "DISCOUNT").reduce((sum, line) => sum + line.amountCents, 0);
  const discountOnTaxable = subtotalCents > 0 ? Math.round((discountCents * taxableCents) / subtotalCents) : 0;
  const taxCents = applyBps(taxableCents - discountOnTaxable, input.taxRateBps);
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
    totalCents: subtotalCents - discountCents + taxCents,
    securityHoldCents: input.securityHoldCents,
    depositCents,
    currency: "usd",
  };
}
