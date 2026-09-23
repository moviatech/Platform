import { describe, expect, it } from "vitest";
import { codePattern, couponProblem, couponState, couponTerms, normalizeCode, type CouponRow } from "./rules";

const row = (patch: Partial<CouponRow> = {}): CouponRow => ({
  id: "c1",
  code: "OPEN10",
  label: null,
  kind: "PERCENT",
  percent_bps: 1000,
  amount_cents: 0,
  max_discount_cents: null,
  valid_from: "2026-11-01",
  valid_to: "2026-11-30",
  min_days: 2,
  class_ids: null,
  location_ids: null,
  max_redemptions: 5,
  per_customer_limit: 1,
  first_order_only: false,
  stackable: false,
  bearer: "COMPANY",
  active: true,
  created_at: "2026-11-01T00:00:00Z",
  ...patch,
});
const context = { today: "2026-11-16", days: 3, classId: "class-a", locationId: "loc-a", attached: false };

describe("normalizeCode", () => {
  it("upper-cases and strips spaces", () => {
    expect(normalizeCode("  open 10 ")).toBe("OPEN10");
    expect(normalizeCode(undefined)).toBe("");
    expect(codePattern.test("OPEN10")).toBe(true);
    expect(codePattern.test("A")).toBe(false);
    expect(codePattern.test("BAD CODE")).toBe(false);
  });
});

describe("couponProblem", () => {
  it("accepts a coupon inside its window and conditions", () => {
    expect(couponProblem(row(), context)).toBeNull();
    expect(couponProblem(row({ valid_from: null, valid_to: null }), context)).toBeNull();
  });

  it("rejects paused, early and late coupons", () => {
    expect(couponProblem(row({ active: false }), context)).toBe("coupon_invalid");
    expect(couponProblem(row(), { ...context, today: "2026-10-31" })).toBe("coupon_invalid");
    expect(couponProblem(row(), { ...context, today: "2026-12-01" })).toBe("coupon_expired");
    expect(couponProblem(row(), { ...context, today: "2026-11-30" })).toBeNull();
  });

  it("checks rental length, vehicle and location", () => {
    expect(couponProblem(row(), { ...context, days: 1 })).toBe("coupon_min_days");
    expect(couponProblem(row({ class_ids: ["class-b"] }), context)).toBe("coupon_not_eligible");
    expect(couponProblem(row({ class_ids: ["class-a"] }), context)).toBeNull();
    expect(couponProblem(row({ location_ids: ["loc-b"] }), context)).toBe("coupon_not_eligible");
    expect(couponProblem(row({ class_ids: [] }), context)).toBeNull();
  });

  it("keeps a coupon already on the order after it is paused or expired, but still checks the trip", () => {
    const attached = { ...context, attached: true, today: "2027-01-01" };
    expect(couponProblem(row({ active: false }), attached)).toBeNull();
    expect(couponProblem(row(), { ...attached, days: 1 })).toBe("coupon_min_days");
  });
});

describe("couponState", () => {
  it("names the state shown in the list", () => {
    expect(couponState(row(), "2026-11-16", 0)).toBe("live");
    expect(couponState(row({ active: false }), "2026-11-16", 0)).toBe("paused");
    expect(couponState(row(), "2026-12-01", 0)).toBe("ended");
    expect(couponState(row(), "2026-11-16", 5)).toBe("used_up");
    expect(couponState(row(), "2026-10-01", 0)).toBe("scheduled");
    expect(couponState(row({ max_redemptions: null }), "2026-11-16", 99)).toBe("live");
  });
});

describe("couponTerms", () => {
  it("maps the stored row to pricing terms", () => {
    expect(couponTerms(row({ bearer: "SHARED", stackable: true }))).toEqual({ id: "c1", code: "OPEN10", kind: "PERCENT", percentBps: 1000, amountCents: 0, maxDiscountCents: null, stackable: true, bearer: "SHARED" });
  });
});
