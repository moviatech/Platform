import type { CouponTerms } from "@/features/pricing/quote";

export type CouponRow = {
  id: string;
  code: string;
  label: string | null;
  kind: "PERCENT" | "AMOUNT";
  percent_bps: number;
  amount_cents: number;
  max_discount_cents: number | null;
  valid_from: string | null;
  valid_to: string | null;
  min_days: number;
  class_ids: string[] | null;
  location_ids: string[] | null;
  max_redemptions: number | null;
  per_customer_limit: number | null;
  first_order_only: boolean;
  stackable: boolean;
  bearer: "COMPANY" | "SHARED";
  active: boolean;
  created_at: string;
};

export const couponColumns = "id, code, label, kind, percent_bps, amount_cents, max_discount_cents, valid_from, valid_to, min_days, class_ids, location_ids, max_redemptions, per_customer_limit, first_order_only, stackable, bearer, active, created_at";

export const couponErrors = ["coupon_invalid", "coupon_expired", "coupon_min_days", "coupon_not_eligible", "coupon_exhausted", "coupon_customer_limit", "coupon_first_order", "coupon_not_combinable"] as const;

export const codePattern = /^[A-Z0-9][A-Z0-9_-]{2,29}$/;

export const normalizeCode = (value: string | null | undefined) => (value ?? "").trim().toUpperCase().replace(/\s+/g, "");

export function couponTerms(row: CouponRow): CouponTerms {
  return { id: row.id, code: row.code, kind: row.kind, percentBps: row.percent_bps, amountCents: row.amount_cents, maxDiscountCents: row.max_discount_cents, stackable: row.stackable, bearer: row.bearer };
}

export type CouponContext = { today: string; days: number; classId: string; locationId: string; attached: boolean };

export function couponProblem(row: CouponRow, context: CouponContext): (typeof couponErrors)[number] | null {
  if (!context.attached) {
    if (!row.active) return "coupon_invalid";
    if (row.valid_from && context.today < row.valid_from) return "coupon_invalid";
    if (row.valid_to && context.today > row.valid_to) return "coupon_expired";
  }
  if (context.days < row.min_days) return "coupon_min_days";
  if (row.class_ids?.length && !row.class_ids.includes(context.classId)) return "coupon_not_eligible";
  if (row.location_ids?.length && !row.location_ids.includes(context.locationId)) return "coupon_not_eligible";
  return null;
}

export function couponState(row: Pick<CouponRow, "active" | "valid_from" | "valid_to" | "max_redemptions">, today: string, used: number) {
  if (!row.active) return "paused" as const;
  if (row.valid_to && today > row.valid_to) return "ended" as const;
  if (row.max_redemptions !== null && used >= row.max_redemptions) return "used_up" as const;
  if (row.valid_from && today < row.valid_from) return "scheduled" as const;
  return "live" as const;
}
