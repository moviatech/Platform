"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { requirePermission } from "@/lib/auth/staff";
import { createAdminClient } from "@/lib/supabase/admin";
import { codePattern, normalizeCode } from "./rules";

export type CouponFormState = { ok?: boolean; error?: "invalid" | "duplicate" | "failed"; at?: number };

const optionalCount = z
  .string()
  .trim()
  .regex(/^\d{0,6}$/)
  .transform((value) => (value === "" || Number(value) === 0 ? null : Number(value)));

const optionalDate = z.union([z.literal(""), z.iso.date()]).transform((value) => value || null);

const input = z.object({
  id: z.union([z.uuid(), z.literal("")]),
  code: z.string().transform(normalizeCode),
  label: z.string().trim().max(120),
  kind: z.enum(["PERCENT", "AMOUNT"]),
  value: z.string().trim().regex(/^\d{1,6}(\.\d{1,2})?$/).transform(Number),
  maxDiscount: z.string().trim().regex(/^(\d{1,6}(\.\d{1,2})?)?$/).transform((value) => (value && Number(value) > 0 ? Math.round(Number(value) * 100) : null)),
  validFrom: optionalDate,
  validTo: optionalDate,
  minDays: z.coerce.number().int().min(1).max(365),
  maxRedemptions: optionalCount,
  perCustomerLimit: optionalCount,
  classIds: z.array(z.uuid()).max(50),
  locationIds: z.array(z.uuid()).max(50),
  firstOrderOnly: z.boolean(),
  stackable: z.boolean(),
  bearer: z.enum(["COMPANY", "SHARED"]),
  active: z.boolean(),
});

export async function saveCoupon(_: CouponFormState, form: FormData): Promise<CouponFormState> {
  const session = await requirePermission("pricing.edit");
  const parsed = input.safeParse({
    id: form.get("id") ?? "",
    code: String(form.get("code") ?? ""),
    label: form.get("label") ?? "",
    kind: form.get("kind"),
    value: form.get("value") ?? "",
    maxDiscount: form.get("maxDiscount") ?? "",
    validFrom: form.get("validFrom") ?? "",
    validTo: form.get("validTo") ?? "",
    minDays: form.get("minDays") || "1",
    maxRedemptions: form.get("maxRedemptions") ?? "",
    perCustomerLimit: form.get("perCustomerLimit") ?? "",
    classIds: form.getAll("classIds").map(String),
    locationIds: form.getAll("locationIds").map(String),
    firstOrderOnly: form.get("firstOrderOnly") === "on",
    stackable: form.get("stackable") === "on",
    bearer: form.get("bearer"),
    active: form.get("active") === "on",
  });
  if (!parsed.success) return { error: "invalid" };
  const data = parsed.data;
  const percent = data.kind === "PERCENT";
  if (data.value <= 0 || (percent && data.value > 100)) return { error: "invalid" };
  if (data.validFrom && data.validTo && data.validFrom > data.validTo) return { error: "invalid" };

  const values = {
    label: data.label || null,
    kind: data.kind,
    percent_bps: percent ? Math.round(data.value * 100) : 0,
    amount_cents: percent ? 0 : Math.round(data.value * 100),
    max_discount_cents: percent ? data.maxDiscount : null,
    valid_from: data.validFrom,
    valid_to: data.validTo,
    min_days: data.minDays,
    class_ids: data.classIds.length ? data.classIds : null,
    location_ids: data.locationIds.length ? data.locationIds : null,
    max_redemptions: data.maxRedemptions,
    per_customer_limit: data.perCustomerLimit,
    first_order_only: data.firstOrderOnly,
    stackable: data.stackable,
    bearer: data.bearer,
    active: data.active,
  };
  const supabase = createAdminClient();
  if (data.id) {
    const { data: updated, error } = await supabase.from("coupons").update(values).eq("id", data.id).select("code").maybeSingle();
    if (error || !updated) return { error: "failed" };
    await audit({ actorUserId: session.userId, actorType: "STAFF", action: "coupon.updated", entityType: "coupon", entityId: data.id, metadata: { by: session.displayName, code: updated.code, ...values } });
  } else {
    if (!codePattern.test(data.code)) return { error: "invalid" };
    const { data: created, error } = await supabase.from("coupons").insert({ ...values, code: data.code, created_by: session.userId }).select("id").single();
    if (error || !created) return { error: error?.code === "23505" ? "duplicate" : "failed" };
    await audit({ actorUserId: session.userId, actorType: "STAFF", action: "coupon.created", entityType: "coupon", entityId: created.id, metadata: { by: session.displayName, code: data.code, ...values } });
  }
  revalidatePath("/ops/coupons");
  return { ok: true, at: Date.now() };
}
