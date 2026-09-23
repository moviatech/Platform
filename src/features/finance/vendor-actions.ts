"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { zonedParts } from "@/features/booking/time";
import { audit } from "@/lib/audit";
import { requirePermission } from "@/lib/auth/staff";
import { createAdminClient } from "@/lib/supabase/admin";
import { isDate } from "./board/range";
import { linkEarlierExpenses } from "./vendor-queries";
import { vendorTaxClasses } from "./vendors";

export type VendorState = { ok?: boolean; error?: "invalid" | "failed" | "duplicate" | "used" | "future" };

const trimmed = (value: FormDataEntryValue | null) => String(value ?? "").trim();

const fields = z.object({
  name: z.string().min(1).max(160),
  taxClass: z.enum(vendorTaxClasses),
  needs1099: z.boolean(),
  w9On: z
    .string()
    .refine((value) => isDate(value))
    .optional(),
  note: z.string().max(1000).optional(),
});

const read = (form: FormData) =>
  fields.safeParse({
    name: trimmed(form.get("name")).replace(/\s+/g, " "),
    taxClass: form.get("taxClass"),
    needs1099: form.get("needs1099") === "on",
    w9On: trimmed(form.get("w9On")) || undefined,
    note: trimmed(form.get("note")) || undefined,
  });

const laToday = () => zonedParts(new Date(), "America/Los_Angeles").date;
const refresh = () => revalidatePath("/ops/finance", "layout");

export async function addVendor(_: VendorState, form: FormData): Promise<VendorState> {
  const session = await requirePermission("finance.review");
  const parsed = read(form);
  if (!parsed.success) return { error: "invalid" };
  const value = parsed.data;
  if (value.w9On && value.w9On > laToday()) return { error: "future" };
  const { data, error } = await createAdminClient()
    .from("fin_vendors")
    .insert({ name: value.name, tax_class: value.taxClass, needs_1099: value.needs1099, w9_received_on: value.w9On ?? null, note: value.note ?? null, created_by: session.userId })
    .select("id")
    .single();
  if (error?.code === "23505") return { error: "duplicate" };
  if (error || !data) return { error: "failed" };
  const linked = await linkEarlierExpenses(data.id, value.name);
  await audit({ actorUserId: session.userId, actorType: "STAFF", action: "finance.vendor_added", entityType: "fin_vendor", entityId: data.id, metadata: { by: session.displayName, name: value.name, taxClass: value.taxClass, needs1099: value.needs1099, w9On: value.w9On ?? null, linked } });
  refresh();
  return { ok: true };
}

export async function updateVendor(_: VendorState, form: FormData): Promise<VendorState> {
  const session = await requirePermission("finance.review");
  const id = z.uuid().safeParse(form.get("id"));
  const parsed = read(form);
  if (!id.success || !parsed.success) return { error: "invalid" };
  const value = parsed.data;
  if (value.w9On && value.w9On > laToday()) return { error: "future" };
  const active = form.get("active") === "on";
  const { data, error } = await createAdminClient()
    .from("fin_vendors")
    .update({ name: value.name, tax_class: value.taxClass, needs_1099: value.needs1099, w9_received_on: value.w9On ?? null, note: value.note ?? null, active, updated_at: new Date().toISOString() })
    .eq("id", id.data)
    .select("id");
  if (error?.code === "23505") return { error: "duplicate" };
  if (error) return { error: "failed" };
  if (!data?.length) return { error: "invalid" };
  const linked = active ? await linkEarlierExpenses(id.data, value.name) : 0;
  await audit({ actorUserId: session.userId, actorType: "STAFF", action: "finance.vendor_updated", entityType: "fin_vendor", entityId: id.data, metadata: { by: session.displayName, name: value.name, taxClass: value.taxClass, needs1099: value.needs1099, w9On: value.w9On ?? null, active, linked } });
  refresh();
  return { ok: true };
}

export async function deleteVendor(_: VendorState, form: FormData): Promise<VendorState> {
  const session = await requirePermission("finance.review");
  const id = z.uuid().safeParse(form.get("id"));
  if (!id.success) return { error: "invalid" };
  const supabase = createAdminClient();
  const { count, error: countError } = await supabase.from("expenses").select("id", { count: "exact", head: true }).eq("vendor_id", id.data);
  if (countError) return { error: "failed" };
  if ((count ?? 0) > 0) return { error: "used" };
  const { data, error } = await supabase.from("fin_vendors").delete().eq("id", id.data).select("id, name");
  if (error) return { error: error.code === "23503" ? "used" : "failed" };
  if (!data?.length) return { error: "invalid" };
  await audit({ actorUserId: session.userId, actorType: "STAFF", action: "finance.vendor_deleted", entityType: "fin_vendor", entityId: id.data, metadata: { by: session.displayName, name: data[0].name } });
  refresh();
  return { ok: true };
}
