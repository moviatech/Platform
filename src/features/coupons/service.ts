import "server-only";
import { zonedParts } from "@/features/booking/time";
import type { CouponTerms } from "@/features/pricing/quote";
import { createAdminClient } from "@/lib/supabase/admin";
import { codePattern, couponColumns, couponProblem, couponTerms, normalizeCode, type CouponRow } from "./rules";

export class CouponError extends Error {
  constructor(public code: string) {
    super(code);
  }
}

const liveStatuses = ["REQUESTED", "PENDING_PAYMENT", "CONFIRMED", "ACTIVE", "COMPLETED", "NO_SHOW"];

export async function findCoupon(code: string): Promise<CouponRow | null> {
  const normalized = normalizeCode(code);
  if (!codePattern.test(normalized)) return null;
  const { data } = await createAdminClient().from("coupons").select(couponColumns).eq("code", normalized).maybeSingle();
  return (data as CouponRow | null) ?? null;
}

export async function resolveCoupon(code: string, context: { days: number; classId: string; locationId: string; attachedId?: string | null; ignoreReservationId?: string | null }): Promise<CouponTerms> {
  const row = await findCoupon(code);
  if (!row) throw new CouponError("coupon_invalid");
  const attached = Boolean(context.attachedId) && row.id === context.attachedId;
  const problem = couponProblem(row, { today: zonedParts(new Date(), "America/Los_Angeles").date, days: context.days, classId: context.classId, locationId: context.locationId, attached });
  if (problem) throw new CouponError(problem);
  if (!attached && row.max_redemptions !== null) {
    let query = createAdminClient().from("reservations").select("id", { count: "exact", head: true }).eq("coupon_id", row.id).in("status", liveStatuses).or(`status.in.(CONFIRMED,ACTIVE,COMPLETED,NO_SHOW),expires_at.is.null,expires_at.gt."${new Date().toISOString()}"`);
    if (context.ignoreReservationId) query = query.neq("id", context.ignoreReservationId);
    const { count } = await query;
    if ((count ?? 0) >= row.max_redemptions) throw new CouponError("coupon_exhausted");
  }
  return couponTerms(row);
}

export type CouponOrder = { id: string; coupon_id: string; number: string; status: string; pickup_at: string; customer: { full_name: string } | null; discountCents: number };
export type CouponUsage = { count: number; discountCents: number; orders: CouponOrder[] };

export async function couponUsage(): Promise<Map<string, CouponUsage>> {
  const usage = new Map<string, CouponUsage>();
  const supabase = createAdminClient();
  for (let from = 0; from < 20000; from += 1000) {
    const { data } = await supabase.from("reservations").select("id, coupon_id, number, status, pickup_at, customer:customers(full_name), quote_snapshot->coupon->discountCents").not("coupon_id", "is", null).order("created_at", { ascending: false }).range(from, from + 999);
    const rows = (data ?? []) as unknown as Array<Omit<CouponOrder, "discountCents"> & { discountCents: number | null }>;
    for (const row of rows) {
      const entry = usage.get(row.coupon_id) ?? { count: 0, discountCents: 0, orders: [] };
      const discountCents = Number(row.discountCents ?? 0);
      if (liveStatuses.includes(row.status)) {
        entry.count += 1;
        entry.discountCents += discountCents;
      }
      if (entry.orders.length < 20) entry.orders.push({ ...row, discountCents });
      usage.set(row.coupon_id, entry);
    }
    if (rows.length < 1000) break;
  }
  return usage;
}

export async function listCoupons(): Promise<CouponRow[]> {
  const { data } = await createAdminClient().from("coupons").select(couponColumns).order("created_at", { ascending: false }).limit(500);
  return (data ?? []) as CouponRow[];
}
