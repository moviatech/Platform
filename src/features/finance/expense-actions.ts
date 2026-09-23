"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { zonedParts } from "@/features/booking/time";
import { audit } from "@/lib/audit";
import { requirePermission } from "@/lib/auth/staff";
import { createAdminClient } from "@/lib/supabase/admin";
import { randomUUID } from "node:crypto";
import { isDate } from "./board/range";
import { receiptBucket } from "./expenses";
import { expenseCategories, expenseMethods, expensePaidFrom, expensePeriodError, maxReceiptBytes, receiptTypes } from "./report";
import { serviceLogError } from "./service-due";
import { vendorIdFor } from "./vendor-queries";

export type ExpenseState = { ok?: boolean; error?: "invalid" | "failed" | "status" | "reason" | "future" | "period" | "capital" | "serviceGone" | "vehicle" | "serviceTaken" };

const trimmed = (value: FormDataEntryValue | null) => String(value ?? "").trim();
const dollars = (value: FormDataEntryValue | null) => Number(trimmed(value).replace(/[,$\s]/g, ""));
const day = z.string().refine((value) => isDate(value));

const input = z.object({
  spentOn: day,
  category: z.enum(expenseCategories),
  amount: z.number().positive().max(1_000_000),
  vendor: z.string().max(160).optional(),
  vehicleId: z.uuid().optional(),
  locationId: z.uuid().optional(),
  method: z.enum(expenseMethods),
  paidFrom: z.enum(expensePaidFrom),
  serviceFrom: day.optional(),
  serviceTo: day.optional(),
  capital: z.boolean(),
  serviceLogId: z.uuid().optional(),
  reference: z.string().max(160).optional(),
  note: z.string().max(1000).optional(),
});

export async function addExpense(_: ExpenseState, form: FormData): Promise<ExpenseState> {
  const session = await requirePermission("finance.review");
  const parsed = input.safeParse({
    spentOn: trimmed(form.get("spentOn")),
    category: form.get("category"),
    amount: dollars(form.get("amount")),
    vendor: trimmed(form.get("vendor")) || undefined,
    vehicleId: trimmed(form.get("vehicleId")) || undefined,
    locationId: trimmed(form.get("locationId")) || undefined,
    method: form.get("method"),
    paidFrom: trimmed(form.get("paidFrom")) || "COMPANY_ACCOUNT",
    serviceFrom: trimmed(form.get("serviceFrom")) || undefined,
    serviceTo: trimmed(form.get("serviceTo")) || undefined,
    capital: form.get("capital") === "on",
    serviceLogId: trimmed(form.get("serviceLogId")) || undefined,
    reference: trimmed(form.get("reference")) || undefined,
    note: trimmed(form.get("note")) || undefined,
  });
  if (!parsed.success) return { error: "invalid" };
  const value = parsed.data;
  if (value.spentOn > zonedParts(new Date(), "America/Los_Angeles").date) return { error: "future" };
  const periodError = expensePeriodError(value);
  if (periodError) return { error: periodError };
  let vehicleId = value.vehicleId;
  if (value.serviceLogId) {
    const { data: log } = await createAdminClient().from("vehicle_service_logs").select("id, vehicle_id").eq("id", value.serviceLogId).maybeSingle();
    const linkError = serviceLogError(log, value.vehicleId);
    if (!log || linkError) return { error: linkError ?? "serviceGone" };
    vehicleId = log.vehicle_id;
  }
  const vendorId = await vendorIdFor(value.vendor);
  const amountCents = Math.round(value.amount * 100);
  const { data, error } = await createAdminClient()
    .from("expenses")
    .insert({
      spent_on: value.spentOn,
      category: value.category,
      amount_cents: amountCents,
      vendor: value.vendor ?? null,
      vehicle_id: vehicleId ?? null,
      location_id: value.locationId ?? null,
      method: value.method,
      paid_from: value.paidFrom,
      service_from: value.serviceFrom ?? null,
      service_to: value.serviceTo ?? null,
      capital: value.capital,
      service_log_id: value.serviceLogId ?? null,
      vendor_id: vendorId,
      reference: value.reference ?? null,
      note: value.note ?? null,
      created_by: session.userId,
    })
    .select("id")
    .single();
  if (error?.code === "23505") return { error: "serviceTaken" };
  if (error || !data) return { error: "failed" };
  await audit({ actorUserId: session.userId, actorType: "STAFF", action: "expense.recorded", entityType: "expense", entityId: data.id, metadata: { by: session.displayName, spentOn: value.spentOn, category: value.category, amountCents, vendor: value.vendor ?? null, vehicleId: vehicleId ?? null, locationId: value.locationId ?? null, method: value.method, paidFrom: value.paidFrom, serviceFrom: value.serviceFrom ?? null, serviceTo: value.serviceTo ?? null, capital: value.capital, serviceLogId: value.serviceLogId ?? null, vendorId } });
  revalidatePath("/ops/finance", "layout");
  return { ok: true };
}

export async function voidExpense(_: ExpenseState, form: FormData): Promise<ExpenseState> {
  const session = await requirePermission("finance.review");
  const parsed = z.object({ id: z.uuid(), reason: z.string().trim().min(2).max(500) }).safeParse({ id: form.get("id"), reason: trimmed(form.get("reason")) });
  if (!parsed.success) return { error: parsed.error.issues.some((issue) => issue.path[0] === "reason") ? "reason" : "invalid" };
  const { data, error } = await createAdminClient().from("expenses").update({ voided_at: new Date().toISOString(), voided_by: session.userId, void_reason: parsed.data.reason }).eq("id", parsed.data.id).is("voided_at", null).select("id, category, amount_cents, spent_on");
  if (error) return { error: "failed" };
  if (!data?.length) return { error: "status" };
  await audit({ actorUserId: session.userId, actorType: "STAFF", action: "expense.voided", entityType: "expense", entityId: parsed.data.id, metadata: { by: session.displayName, reason: parsed.data.reason, category: data[0].category, amountCents: data[0].amount_cents, spentOn: data[0].spent_on } });
  revalidatePath("/ops/finance", "layout");
  return { ok: true };
}

export type ReceiptTarget = { path: string; url: string } | null;

async function openExpense(id: string) {
  if (!z.uuid().safeParse(id).success) return null;
  const { data } = await createAdminClient().from("expenses").select("id, voided_at").eq("id", id).maybeSingle();
  return data && !data.voided_at ? data : null;
}

export async function createReceiptUpload(expenseId: string, file: { type: string; size: number }): Promise<ReceiptTarget> {
  await requirePermission("finance.review");
  if (!receiptTypes.test(file.type) || !Number.isInteger(file.size) || file.size <= 0 || file.size > maxReceiptBytes) return null;
  if (!(await openExpense(expenseId))) return null;
  const extension = file.type === "application/pdf" ? "pdf" : file.type.split("/")[1].replace("jpeg", "jpg");
  const path = `${expenseId}/${randomUUID()}.${extension}`;
  const { data } = await createAdminClient().storage.from(receiptBucket).createSignedUploadUrl(path);
  return data ? { path, url: data.signedUrl } : null;
}

export async function attachReceipt(expenseId: string, path: string, contentType: string, size: number): Promise<{ ok: boolean }> {
  const session = await requirePermission("finance.review");
  if (!receiptTypes.test(contentType) || !Number.isInteger(size) || size <= 0 || size > maxReceiptBytes) return { ok: false };
  if (!(await openExpense(expenseId)) || !new RegExp(`^${expenseId}/[0-9a-f-]{36}\\.[a-z]{3,4}$`).test(path)) return { ok: false };
  const admin = createAdminClient();
  const { data: stored } = await admin.storage.from(receiptBucket).list(expenseId, { search: path.split("/")[1] });
  if (!stored?.some((item) => `${expenseId}/${item.name}` === path)) return { ok: false };
  const { data, error } = await admin.from("expense_receipts").insert({ expense_id: expenseId, storage_path: path, content_type: contentType, size_bytes: size, uploaded_by: session.userId }).select("id").single();
  if (error || !data) return { ok: false };
  await audit({ actorUserId: session.userId, actorType: "STAFF", action: "expense.receipt_added", entityType: "expense", entityId: expenseId, metadata: { by: session.displayName, receiptId: data.id, contentType, size } });
  revalidatePath("/ops/finance", "layout");
  return { ok: true };
}

export async function skipServiceLog(_: ExpenseState, form: FormData): Promise<ExpenseState> {
  const session = await requirePermission("finance.review");
  const parsed = z.object({ serviceLogId: z.uuid(), reason: z.string().trim().min(2).max(500) }).safeParse({ serviceLogId: form.get("serviceLogId"), reason: trimmed(form.get("reason")) });
  if (!parsed.success) return { error: parsed.error.issues.some((issue) => issue.path[0] === "reason") ? "reason" : "invalid" };
  const supabase = createAdminClient();
  const { data: log } = await supabase.from("vehicle_service_logs").select("id, vehicle_id, kind, performed_on, cost_cents").eq("id", parsed.data.serviceLogId).maybeSingle();
  if (!log) return { error: "serviceGone" };
  const { count, error: countError } = await supabase.from("expenses").select("id", { count: "exact", head: true }).eq("service_log_id", log.id).is("voided_at", null);
  if (countError) return { error: "failed" };
  if ((count ?? 0) > 0) return { error: "serviceTaken" };
  const { error } = await supabase.from("fin_service_log_skips").insert({ service_log_id: log.id, reason: parsed.data.reason, skipped_by: session.userId });
  if (error && error.code !== "23505") return { error: "failed" };
  await audit({ actorUserId: session.userId, actorType: "STAFF", action: "finance.service_log_skipped", entityType: "vehicle", entityId: log.vehicle_id, metadata: { by: session.displayName, serviceLogId: log.id, kind: log.kind, performedOn: log.performed_on, costCents: log.cost_cents, reason: parsed.data.reason } });
  revalidatePath("/ops/finance", "layout");
  return { ok: true };
}
