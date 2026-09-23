"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { requirePermission } from "@/lib/auth/staff";
import { createAdminClient } from "@/lib/supabase/admin";

export type LocationFormState = { ok?: boolean; error?: "invalid" | "duplicate" | "inUse" | "failed" };

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((value) => value || null);

const input = z.object({
  id: z.union([z.uuid(), z.literal("")]),
  name: z.string().trim().min(1).max(80),
  nameZh: optionalText(80),
  address: optionalText(300),
  taxRate: z
    .string()
    .trim()
    .transform((value) => (value === "" ? 0 : Number(value)))
    .refine((value) => Number.isFinite(value) && value >= 0 && value <= 30),
  pickupInstructions: optionalText(1000),
  pickupInstructionsZh: optionalText(1000),
  active: z.boolean(),
});

const codeFor = (name: string) => name.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12) || "LOC";

function refresh() {
  revalidatePath("/ops/locations");
  revalidatePath("/ops/fleet", "layout");
}

export async function saveLocation(_: LocationFormState, form: FormData): Promise<LocationFormState> {
  const session = await requirePermission("vehicle.edit");
  const parsed = input.safeParse({
    id: form.get("id") ?? "",
    name: form.get("name"),
    nameZh: form.get("nameZh") ?? "",
    address: form.get("address") ?? "",
    taxRate: form.get("taxRate") ?? "",
    pickupInstructions: form.get("pickupInstructions") ?? "",
    pickupInstructionsZh: form.get("pickupInstructionsZh") ?? "",
    active: form.get("active") === "on",
  });
  if (!parsed.success) return { error: "invalid" };
  const values = {
    name: parsed.data.name,
    name_zh: parsed.data.nameZh,
    address: parsed.data.address,
    tax_rate_bps: Math.round(parsed.data.taxRate * 100),
    pickup_instructions: parsed.data.pickupInstructions,
    pickup_instructions_zh: parsed.data.pickupInstructionsZh,
    active: parsed.data.active,
  };
  const admin = createAdminClient();

  if (parsed.data.id) {
    const { error } = await admin.from("locations").update(values).eq("id", parsed.data.id);
    if (error) return { error: error.code === "23505" ? "duplicate" : "failed" };
    await audit({ actorUserId: session.userId, actorType: "STAFF", action: "location.updated", entityType: "location", entityId: parsed.data.id, metadata: { by: session.displayName, name: values.name } });
    refresh();
    redirect("/locations");
  }

  const base = codeFor(parsed.data.name);
  let { data: created, error } = await admin.from("locations").insert({ ...values, code: base }).select("id").single();
  if (error?.code === "23505") ({ data: created, error } = await admin.from("locations").insert({ ...values, code: `${base}${Date.now().toString(36).slice(-3).toUpperCase()}` }).select("id").single());
  if (error || !created) return { error: "failed" };
  await audit({ actorUserId: session.userId, actorType: "STAFF", action: "location.created", entityType: "location", entityId: created.id, metadata: { by: session.displayName, name: values.name } });
  refresh();
  redirect("/locations");
}

export async function deleteLocation(form: FormData) {
  const session = await requirePermission("vehicle.edit");
  const parsed = z.uuid().safeParse(form.get("id"));
  if (!parsed.success) return;
  const admin = createAdminClient();
  const { count } = await admin.from("locations").select("id", { count: "exact", head: true });
  if ((count ?? 0) <= 1) return;
  const { error } = await admin.from("locations").delete().eq("id", parsed.data);
  if (error) return;
  await audit({ actorUserId: session.userId, actorType: "STAFF", action: "location.deleted", entityType: "location", entityId: parsed.data, metadata: { by: session.displayName } });
  refresh();
}
