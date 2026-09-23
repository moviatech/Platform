"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { requirePermission } from "@/lib/auth/staff";
import { createAdminClient } from "@/lib/supabase/admin";

export type PricingFormState = { ok?: boolean; error?: boolean };

const dollars = z
  .string()
  .trim()
  .regex(/^\d{1,6}(\.\d{1,2})?$/)
  .transform((value) => Math.round(Number(value) * 100));

const classInput = z.object({
  id: z.uuid(),
  dailyRate: dollars,
  securityHold: dollars,
  bufferHours: z.coerce.number().int().min(0).max(72),
  active: z.boolean(),
});

export async function saveClassPricing(_: PricingFormState, form: FormData): Promise<PricingFormState> {
  const session = await requirePermission("pricing.edit");
  const parsed = classInput.safeParse({
    id: form.get("id"),
    dailyRate: form.get("dailyRate"),
    securityHold: form.get("securityHold"),
    bufferHours: form.get("bufferHours"),
    active: form.get("active") === "on",
  });
  if (!parsed.success) return { error: true };
  const input = parsed.data;

  const supabase = createAdminClient();
  const { data: before } = await supabase.from("vehicle_classes").select("slug, base_daily_rate_cents, security_hold_cents, buffer_hours, active").eq("id", input.id).maybeSingle();
  const { error } = await supabase
    .from("vehicle_classes")
    .update({ base_daily_rate_cents: input.dailyRate, security_hold_cents: input.securityHold, buffer_hours: input.bufferHours, active: input.active })
    .eq("id", input.id);
  if (error) return { error: true };

  await audit({
    actorUserId: session.userId,
    actorType: "STAFF",
    action: "pricing.class_updated",
    entityType: "vehicle_class",
    entityId: input.id,
    metadata: { by: session.displayName, slug: before?.slug, before, after: input },
  });
  revalidatePath("/ops/pricing");
  return { ok: true };
}

const overrideInput = z
  .object({
    classId: z.uuid(),
    dateFrom: z.iso.date(),
    dateTo: z.iso.date(),
    dailyRate: dollars,
    note: z.string().trim().max(120),
  })
  .refine((value) => value.dateTo >= value.dateFrom);

export async function addRateOverride(_: PricingFormState, form: FormData): Promise<PricingFormState> {
  const session = await requirePermission("pricing.edit");
  const parsed = overrideInput.safeParse({
    classId: form.get("classId"),
    dateFrom: form.get("dateFrom"),
    dateTo: form.get("dateTo"),
    dailyRate: form.get("dailyRate"),
    note: form.get("note") ?? "",
  });
  if (!parsed.success) return { error: true };
  const input = parsed.data;

  const { data, error } = await createAdminClient()
    .from("rate_overrides")
    .insert({ class_id: input.classId, date_from: input.dateFrom, date_to: input.dateTo, daily_rate_cents: input.dailyRate, note: input.note || null })
    .select("id")
    .single();
  if (error || !data) return { error: true };

  await audit({
    actorUserId: session.userId,
    actorType: "STAFF",
    action: "pricing.override_created",
    entityType: "vehicle_class",
    entityId: input.classId,
    metadata: { by: session.displayName, overrideId: data.id, from: input.dateFrom, to: input.dateTo, dailyRateCents: input.dailyRate },
  });
  revalidatePath("/ops/pricing");
  return { ok: true };
}

export async function removeRateOverride(form: FormData) {
  const session = await requirePermission("pricing.edit");
  const parsed = z.object({ overrideId: z.uuid(), classId: z.uuid() }).safeParse({ overrideId: form.get("overrideId"), classId: form.get("classId") });
  if (!parsed.success) return;
  const { error } = await createAdminClient().from("rate_overrides").delete().eq("id", parsed.data.overrideId);
  if (error) return;
  await audit({
    actorUserId: session.userId,
    actorType: "STAFF",
    action: "pricing.override_removed",
    entityType: "vehicle_class",
    entityId: parsed.data.classId,
    metadata: { by: session.displayName, overrideId: parsed.data.overrideId },
  });
  revalidatePath("/ops/pricing");
}
