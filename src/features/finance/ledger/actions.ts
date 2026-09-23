"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { requirePermission } from "@/lib/auth/staff";
import { createAdminClient } from "@/lib/supabase/admin";
import { financeBook, financeLiveKey } from "./engine";
import { APPROVAL_THRESHOLD_CENTS } from "./other-targets";
import { findOrder } from "./views";

export type LedgerState = { ok?: boolean; error?: "invalid" | "failed" | "reason" | "self" | "status" };

const resolutionCategories = ["INCOME_DAMAGE", "INCOME_FEES", "INCOME_OTHER", "ALLOWANCE", "BAD_DEBT", "REFUND_PAYABLE"] as const;
const trimmed = (value: FormDataEntryValue | null) => String(value ?? "").trim();
const dollars = (value: FormDataEntryValue | null) => Number(trimmed(value).replace(/[,$\s]/g, ""));
const reasonError = (issues: z.core.$ZodIssue[]): LedgerState => ({ error: issues.some((issue) => issue.path[0] === "reason" || issue.path[0] === "note") ? "reason" : "invalid" });

function currentBook() {
  const book = financeBook();
  return { book, liveKey: book === "live" ? financeLiveKey() : null };
}

async function postedKeys(book: string, objectType: "reservation" | "investor", objectId: string) {
  const admin = createAdminClient();
  if (objectType === "reservation") {
    const { data } = await admin.rpc("fin_source_balances", { p_book: book, p_source_type: null, p_key_prefix: `order:${objectId}:` });
    return [...new Set(((data ?? []) as Array<{ source_key: string }>).map((row) => row.source_key))];
  }
  const { data } = await admin.from("fin_journal_lines").select("entry:fin_journal_entries!inner(book, source_key)").eq("investor_id", objectId).eq("entry.book", book).limit(500);
  return [...new Set(((data ?? []) as unknown as Array<{ entry: { source_key: string } | null }>).map((row) => row.entry?.source_key).filter((key): key is string => Boolean(key)))];
}

const done = (): LedgerState => {
  revalidatePath("/ops/finance", "layout");
  return { ok: true };
};

export async function addResolution(_: LedgerState, form: FormData): Promise<LedgerState> {
  const session = await requirePermission("finance.ledger");
  const parsed = z
    .object({ number: z.string().min(4).max(20), category: z.enum(resolutionCategories), amount: z.number().positive().max(1_000_000), reason: z.string().min(2).max(1000), evidence: z.string().max(500).optional() })
    .safeParse({ number: trimmed(form.get("number")), category: form.get("category"), amount: dollars(form.get("amount")), reason: trimmed(form.get("reason")), evidence: trimmed(form.get("evidence")) || undefined });
  if (!parsed.success) return reasonError(parsed.error.issues);
  const admin = createAdminClient();
  const order = await findOrder(parsed.data.number);
  if (!order) return { error: "invalid" };
  const { book, liveKey } = currentBook();
  const amountCents = Math.round(parsed.data.amount * 100);
  const { data: id, error } = await admin.rpc("fin_add_resolution", { p_book: book, p_live_key: liveKey, p_reservation_id: order.id, p_category: parsed.data.category, p_amount_cents: amountCents, p_reason: parsed.data.reason, p_evidence_path: parsed.data.evidence ?? null, p_created_by: session.userId });
  if (error || !id) return { error: "failed" };
  await audit({ actorUserId: session.userId, actorType: "STAFF", action: "finance.resolution_added", entityType: "reservation", entityId: order.id, metadata: { by: session.displayName, resolutionId: id, book, number: order.number, category: parsed.data.category, amountCents, needsApproval: amountCents > APPROVAL_THRESHOLD_CENTS } });
  return done();
}

export async function approveResolution(_: LedgerState, form: FormData): Promise<LedgerState> {
  const session = await requirePermission("finance.ledger");
  const parsed = z.object({ id: z.uuid() }).safeParse({ id: trimmed(form.get("id")) });
  if (!parsed.success) return { error: "invalid" };
  const admin = createAdminClient();
  const { book, liveKey } = currentBook();
  const { data: row } = await admin.from("fin_order_resolutions").select("id, reservation_id, category, amount_cents, created_by").eq("id", parsed.data.id).eq("book", book).maybeSingle();
  if (!row) return { error: "invalid" };
  if (row.created_by === session.userId) return { error: "self" };
  const { error } = await admin.rpc("fin_approve_resolution", { p_book: book, p_live_key: liveKey, p_id: row.id, p_by: session.userId });
  if (error) return { error: error.message.includes("cannot_approve") ? "status" : "failed" };
  await audit({ actorUserId: session.userId, actorType: "STAFF", action: "finance.resolution_approved", entityType: "reservation", entityId: row.reservation_id, metadata: { by: session.displayName, resolutionId: row.id, book, category: row.category, amountCents: row.amount_cents } });
  return done();
}

export async function voidResolution(_: LedgerState, form: FormData): Promise<LedgerState> {
  const session = await requirePermission("finance.ledger");
  const parsed = z.object({ id: z.uuid(), reason: z.string().min(2).max(500) }).safeParse({ id: trimmed(form.get("id")), reason: trimmed(form.get("reason")) });
  if (!parsed.success) return reasonError(parsed.error.issues);
  const admin = createAdminClient();
  const { book, liveKey } = currentBook();
  const { data: row } = await admin.from("fin_order_resolutions").select("id, reservation_id, category, amount_cents").eq("id", parsed.data.id).eq("book", book).maybeSingle();
  if (!row) return { error: "invalid" };
  const { error } = await admin.rpc("fin_void_resolution", { p_book: book, p_live_key: liveKey, p_id: row.id, p_by: session.userId, p_reason: parsed.data.reason });
  if (error) return { error: error.message.includes("cannot_void") ? "status" : "failed" };
  await audit({ actorUserId: session.userId, actorType: "STAFF", action: "finance.resolution_voided", entityType: "reservation", entityId: row.reservation_id, metadata: { by: session.displayName, resolutionId: row.id, book, reason: parsed.data.reason, category: row.category, amountCents: row.amount_cents } });
  return done();
}

export async function setInclusion(_: LedgerState, form: FormData): Promise<LedgerState> {
  const session = await requirePermission("finance.ledger");
  const parsed = z
    .object({ objectType: z.enum(["reservation", "investor"]), number: z.string().min(4).max(20), included: z.enum(["true", "false"]), reason: z.string().min(2).max(500) })
    .safeParse({ objectType: form.get("objectType"), number: trimmed(form.get("number")), included: form.get("included"), reason: trimmed(form.get("reason")) });
  if (!parsed.success) return reasonError(parsed.error.issues);
  const admin = createAdminClient();
  const objectType = parsed.data.objectType;
  const target =
    objectType === "reservation"
      ? await findOrder(parsed.data.number)
      : (((await admin.from("investors").select("id, investor_number").eq("investor_number", parsed.data.number.toUpperCase()).is("company_id", null).maybeSingle()).data ?? null) as { id: string } | null);
  if (!target) return { error: "invalid" };
  const objectId = target.id;
  const included = parsed.data.included === "true";
  const { data: before } = await admin.from("fin_inclusions").select("included").eq("object_type", objectType).eq("object_id", objectId).maybeSingle();
  const { error } = await admin.from("fin_inclusions").upsert({ object_type: objectType, object_id: objectId, included, reason: parsed.data.reason, set_by: session.userId, set_at: new Date().toISOString() }, { onConflict: "object_type,object_id" });
  if (error) return { error: "failed" };
  const { book } = currentBook();
  const posted = await postedKeys(book, objectType, objectId);
  if (posted.length > 0) {
    await admin.from("fin_exceptions").upsert({ book, kind: "inclusion_review", dedupe_key: `inclusion_review:${objectType}:${objectId}:${included}`, reservation_id: objectType === "reservation" ? objectId : null, investor_id: objectType === "investor" ? objectId : null, detail: { included, keys: posted.slice(0, 50) } }, { onConflict: "book,dedupe_key", ignoreDuplicates: true });
  }
  await audit({ actorUserId: session.userId, actorType: "STAFF", action: "finance.exclusion_changed", entityType: objectType, entityId: objectId, metadata: { by: session.displayName, number: parsed.data.number.toUpperCase(), included, before: before?.included ?? null, reason: parsed.data.reason, postedKeys: posted.length } });
  return done();
}

export async function resolveException(_: LedgerState, form: FormData): Promise<LedgerState> {
  const session = await requirePermission("finance.ledger");
  const parsed = z.object({ id: z.coerce.number().int().positive(), note: z.string().min(2).max(1000) }).safeParse({ id: trimmed(form.get("id")), note: trimmed(form.get("note")) });
  if (!parsed.success) return reasonError(parsed.error.issues);
  const { book } = currentBook();
  const { data, error } = await createAdminClient().from("fin_exceptions").update({ status: "RESOLVED", resolved_at: new Date().toISOString(), resolved_by: session.userId, note: parsed.data.note }).eq("id", parsed.data.id).eq("book", book).eq("status", "OPEN").select("id, kind, dedupe_key, reservation_id");
  if (error) return { error: "failed" };
  if (!data?.length) return { error: "status" };
  await audit({ actorUserId: session.userId, actorType: "STAFF", action: "finance.exception_resolved", entityType: "finance_exception", entityId: String(parsed.data.id), metadata: { by: session.displayName, book, kind: data[0].kind, key: data[0].dedupe_key, reservationId: data[0].reservation_id, note: parsed.data.note } });
  return done();
}

export async function lockMonth(_: LedgerState, form: FormData): Promise<LedgerState> {
  const session = await requirePermission("finance.close");
  const parsed = z.object({ period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/) }).safeParse({ period: trimmed(form.get("period")) });
  if (!parsed.success) return { error: "invalid" };
  const { book, liveKey } = currentBook();
  const { data, error } = await createAdminClient().rpc("fin_lock_period", { p_book: book, p_live_key: liveKey, p_period: parsed.data.period, p_by: session.userId });
  if (error) return { error: error.message.includes("period_locked") ? "status" : "failed" };
  const result = (data ?? {}) as { entries?: number; digest?: string };
  await audit({ actorUserId: session.userId, actorType: "STAFF", action: "finance.period_locked", entityType: "finance_period", entityId: `${book}:${parsed.data.period}`, metadata: { by: session.displayName, book, period: parsed.data.period, entries: result.entries ?? null, digest: result.digest ?? null } });
  return done();
}

export async function reopenMonth(_: LedgerState, form: FormData): Promise<LedgerState> {
  const session = await requirePermission("finance.close");
  const parsed = z.object({ period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/), reason: z.string().min(2).max(500) }).safeParse({ period: trimmed(form.get("period")), reason: trimmed(form.get("reason")) });
  if (!parsed.success) return reasonError(parsed.error.issues);
  const { book, liveKey } = currentBook();
  const { error } = await createAdminClient().rpc("fin_reopen_period", { p_book: book, p_live_key: liveKey, p_period: parsed.data.period, p_by: session.userId, p_reason: parsed.data.reason });
  if (error) return { error: error.message.includes("period_not_locked") ? "status" : "failed" };
  await audit({ actorUserId: session.userId, actorType: "STAFF", action: "finance.period_reopened", entityType: "finance_period", entityId: `${book}:${parsed.data.period}`, metadata: { by: session.displayName, book, period: parsed.data.period, reason: parsed.data.reason } });
  return done();
}
