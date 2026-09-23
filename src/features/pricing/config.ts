import { z } from "zod";

const cents = z.number().int().min(0);
const bps = z.number().int().min(0).max(10000);

export const pricingConfigSchema = z.object({
  rateTiers: z.array(z.object({ id: z.string(), minDays: z.number().int().min(1), multiplierBps: bps })).min(1),
  maxRentalDays: z.number().int().min(1),
  minLeadHours: z.number().min(0),
  bookingWindow: z.object({ start: z.string(), end: z.string(), stepMinutes: z.number().int().min(5) }),
  protectionChargeCapDays: z.number().int().min(1),
  protectionPlans: z.array(z.object({ id: z.string(), dailyCents: cents, monthlyCents: cents, deductibleCents: cents.nullable() })).min(1),
  addOns: z.array(
    z.discriminatedUnion("kind", [
      z.object({ id: z.string(), kind: z.literal("perDay"), priceCents: cents }),
      z.object({ id: z.string(), kind: z.literal("free"), depositCents: cents.optional() }),
      z.object({ id: z.string(), kind: z.literal("rentPercent"), percentBps: bps }),
    ]),
  ),
  payNowDiscountBps: bps,
  youngDriver: z.object({ minAge: z.number().int(), maxAge: z.number().int(), feeDailyCents: cents }),
  deliveryFeeCents: cents,
  returnGraceMinutes: z.number().int().min(0),
  lateReturn: z.object({ notifiedFeeCents: cents, unannouncedFeeCents: cents }).default({ notifiedFeeCents: 20000, unannouncedFeeCents: 50000 }),
  holdRenewDays: z.number().int().min(1),
  citationHoldCents: cents,
  mileage: z.object({
    allowance: z.object({ daily: z.number().int(), weekly: z.number().int(), monthly: z.number().int() }),
    excessRateCents: z.record(z.string(), cents),
  }),
  charge: z.object({ minReturnLevel: z.number().int().min(0).max(100), lowChargeFeeCentsPerPercent: cents }),
  cancelPolicy: z.object({
    short: z.object({ freeHours: z.number(), lateDays: z.number(), noShowMaxDays: z.number() }),
    monthly: z.object({
      freeHours: z.number(),
      feeHours: z.number(),
      feeCents: cents,
      lateHours: z.number(),
      lateDays: z.number(),
      finalDays: z.number(),
      noShowDays: z.number(),
    }),
  }),
  requestHoldHours: z.number().min(1),
  checkoutHoldMinutes: z.number().int().min(30),
  tax: z
    .object({ protection: z.boolean(), addOns: z.boolean(), youngDriver: z.boolean(), delivery: z.boolean(), returnFees: z.boolean() })
    .default({ protection: true, addOns: true, youngDriver: true, delivery: true, returnFees: false }),
});

export type PricingConfig = z.infer<typeof pricingConfigSchema>;

export const ageBands = ["25_PLUS", "21_24"] as const;
export type AgeBand = (typeof ageBands)[number];

export const ratePlans = ["PAY_NOW", "PAY_LATER"] as const;
export type RatePlan = (typeof ratePlans)[number];

export const pickupMethods = ["STORE", "DELIVERY"] as const;
export type PickupMethod = (typeof pickupMethods)[number];
