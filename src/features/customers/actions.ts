"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { requirePermission } from "@/lib/auth/staff";
import { createAdminClient } from "@/lib/supabase/admin";

export type CustomerFormState = { ok?: boolean; error?: "invalid" | "duplicate" | "failed" | "contact_required" };

const input = z.object({
  id: z.uuid(),
  fullName: z.string().trim().min(1).max(120),
  email: z.union([z.email().max(200), z.literal("")]),
  phone: z.string().trim().max(40),
  wechat: z.string().trim().max(60),
  language: z.enum(["zh", "en"]),
  dateOfBirth: z.union([z.iso.date(), z.literal("")]),
  dnrFlag: z.boolean(),
  dnrReason: z.string().trim().max(500),
  internalNotes: z.string().trim().max(4000),
});

export async function saveCustomer(_: CustomerFormState, form: FormData): Promise<CustomerFormState> {
  const session = await requirePermission("customer.edit");
  const parsed = input.safeParse({
    id: form.get("id"),
    fullName: form.get("fullName"),
    email: String(form.get("email") ?? "").trim(),
    phone: form.get("phone") ?? "",
    wechat: form.get("wechat") ?? "",
    language: form.get("language"),
    dateOfBirth: form.get("dateOfBirth") ?? "",
    dnrFlag: form.get("dnrFlag") === "on",
    dnrReason: form.get("dnrReason") ?? "",
    internalNotes: form.get("internalNotes") ?? "",
  });
  if (!parsed.success) return { error: "invalid" };
  const data = parsed.data;

  const supabase = createAdminClient();
  const { data: before } = await supabase.from("customers").select("dnr_flag").eq("id", data.id).maybeSingle();
  const { error } = await supabase
    .from("customers")
    .update({
      full_name: data.fullName,
      email: data.email ? data.email.toLowerCase() : null,
      phone: data.phone || null,
      wechat: data.wechat || null,
      preferred_language: data.language,
      date_of_birth: data.dateOfBirth || null,
      dnr_flag: data.dnrFlag,
      dnr_reason: data.dnrFlag ? data.dnrReason || null : null,
      internal_notes: data.internalNotes || null,
    })
    .eq("id", data.id);
  if (error) return { error: error.code === "23505" ? "duplicate" : "failed" };

  await audit({
    actorUserId: session.userId,
    actorType: "STAFF",
    action: before?.dnr_flag !== data.dnrFlag ? "customer.dnr_changed" : "customer.updated",
    entityType: "customer",
    entityId: data.id,
    metadata: { by: session.displayName, dnr: data.dnrFlag },
  });
  revalidatePath("/ops/customers", "layout");
  return { ok: true };
}

const createInput = z.object({
  fullName: z.string().trim().min(1).max(120),
  email: z.union([z.email().max(200), z.literal("")]),
  phone: z.string().trim().max(40),
  wechat: z.string().trim().max(60),
  language: z.enum(["zh", "en"]),
  dateOfBirth: z.union([z.iso.date(), z.literal("")]),
  internalNotes: z.string().trim().max(4000),
});

export async function createCustomer(_: CustomerFormState, form: FormData): Promise<CustomerFormState> {
  const session = await requirePermission("customer.edit");
  const parsed = createInput.safeParse({
    fullName: form.get("fullName"),
    email: String(form.get("email") ?? "").trim(),
    phone: form.get("phone") ?? "",
    wechat: form.get("wechat") ?? "",
    language: form.get("language"),
    dateOfBirth: form.get("dateOfBirth") ?? "",
    internalNotes: form.get("internalNotes") ?? "",
  });
  if (!parsed.success) return { error: "invalid" };
  const data = parsed.data;
  if (!data.email && !data.phone && !data.wechat) return { error: "contact_required" };

  const { data: created, error } = await createAdminClient()
    .from("customers")
    .insert({
      full_name: data.fullName,
      email: data.email ? data.email.toLowerCase() : null,
      phone: data.phone || null,
      wechat: data.wechat || null,
      preferred_language: data.language,
      date_of_birth: data.dateOfBirth || null,
      internal_notes: data.internalNotes || null,
    })
    .select("id")
    .single();
  if (error || !created) return { error: error?.code === "23505" ? "duplicate" : "failed" };

  await audit({
    actorUserId: session.userId,
    actorType: "STAFF",
    action: "customer.created",
    entityType: "customer",
    entityId: created.id,
    metadata: { by: session.displayName },
  });
  revalidatePath("/ops/customers", "layout");
  redirect("/customers/" + created.id);
}
