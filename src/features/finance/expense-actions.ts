"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { zonedParts } from "@/features/booking/time";
import { audit } from "@/lib/audit";
import { requirePermission } from "@/lib/auth/staff";
import { createAdminClient } from "@/lib/supabase/admin";
import { randomUUID } from "node:crypto";
import { receiptBucket } from "./expenses";
import { expenseCategories, expenseMethods, maxReceiptBytes, receiptTypes } from "./report";

export type ExpenseState = { ok?: boolean; error?: "invalid" | "failed" | "status" | "reason" | "future" };

const trimmed = (value: FormDataEntryValue | null) => String(value ?? "").trim();
const dollars = (value: FormDataEntryValue | null) => Number(trimmed(value).replace(/[,$\s]/g, ""));

const input = z.object({
  spentOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  category: z.enum(expenseCategories),
  amount: z.number().positive().max(1_000_000),
  vendor: z.string().max(160).optional(),
  vehicleId: z.uuid().optional(),
  method: z.enum(expenseMethods),
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
    method: form.get("method"),
    reference: trimmed(form.get("reference")) || undefined,
    note: trimmed(form.get("note")) || undefined,
  });
  if (!parsed.success) return { error: "invalid" };
  if (parsed.data.spentOn > zonedParts(new Date(), "America/Los_Angeles").date) return { error: "future" };
  const amountCents = Math.round(parsed.data.amount * 100);
  const { data, error } = await createAdminClient()
    .from("expenses")
    .insert({ spent_on: parsed.data.spentOn, category: parsed.data.category, amount_cents: amountCents, vendor: parsed.data.vendor ?? null, vehicle_id: parsed.data.vehicleId ?? null, method: parsed.data.method, reference: parsed.data.reference ?? null, note: parsed.data.note ?? null, created_by: session.userId })
    .select("id")
    .single();
  if (error || !data) return { error: "failed" };
  await audit({ actorUserId: session.userId, actorType: "STAFF", action: "expense.recorded", entityType: "expense", entityId: data.id, metadata: { by: session.displayName, spentOn: parsed.data.spentOn, category: parsed.data.category, amountCents, vendor: parsed.data.vendor ?? null, vehicleId: parsed.data.vehicleId ?? null, method: parsed.data.method } });
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
