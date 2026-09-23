"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { zonedParts } from "@/features/booking/time";
import { audit } from "@/lib/audit";
import { requirePermission } from "@/lib/auth/staff";
import { createAdminClient } from "@/lib/supabase/admin";
import { isDate } from "./board/range";
import { coverage, isDue, recurringIntervals, recurringStartError, settlementKinds } from "./recurring";
import { expenseCategories, expenseMethods, expensePaidFrom } from "./report";
import { vendorIdFor } from "./vendor-queries";

export type RecurringState = { ok?: boolean; expenseId?: string; error?: "invalid" | "failed" | "start" | "end" | "used" | "gone" | "taken" | "future" | "reason" | "status" };

const trimmed = (value: FormDataEntryValue | null | undefined) => String(value ?? "").trim();
const dollars = (value: FormDataEntryValue | null | undefined) => Number(trimmed(value).replace(/[,$\s]/g, ""));
const day = z.string().refine((value) => isDate(value));
const money = z.number().positive().max(1_000_000);
const laToday = () => zonedParts(new Date(), "America/Los_Angeles").date;
const refresh = () => revalidatePath("/ops/finance", "layout");

const template = z.object({
  name: z.string().min(1).max(80),
  category: z.enum(expenseCategories),
  amount: money,
  everyMonths: z.number().refine((value) => (recurringIntervals as readonly number[]).includes(value)),
  startsOn: day,
  endsOn: day.optional(),
  vendor: z.string().max(160).optional(),
  vehicleId: z.uuid().optional(),
  locationId: z.uuid().optional(),
  method: z.enum(expenseMethods),
  paidFrom: z.enum(expensePaidFrom),
  spread: z.boolean(),
  note: z.string().max(1000).optional(),
});

export async function addRecurring(_: RecurringState, form: FormData): Promise<RecurringState> {
  const session = await requirePermission("finance.review");
  const parsed = template.safeParse({
    name: trimmed(form.get("name")),
    category: form.get("category"),
    amount: dollars(form.get("amount")),
    everyMonths: Number(form.get("everyMonths")),
    startsOn: trimmed(form.get("startsOn")),
    endsOn: trimmed(form.get("endsOn")) || undefined,
    vendor: trimmed(form.get("vendor")) || undefined,
    vehicleId: trimmed(form.get("vehicleId")) || undefined,
    locationId: trimmed(form.get("locationId")) || undefined,
    method: form.get("method"),
    paidFrom: trimmed(form.get("paidFrom")) || "COMPANY_ACCOUNT",
    spread: form.get("spread") === "on",
    note: trimmed(form.get("note")) || undefined,
  });
  if (!parsed.success) return { error: "invalid" };
  const value = parsed.data;
  const startError = recurringStartError(value.startsOn, value.endsOn, laToday());
  if (startError) return { error: startError };
  const amountCents = Math.round(value.amount * 100);
  const { data, error } = await createAdminClient()
    .from("fin_recurring")
    .insert({
      name: value.name,
      category: value.category,
      amount_cents: amountCents,
      every_months: value.everyMonths,
      starts_on: value.startsOn,
      ends_on: value.endsOn ?? null,
      vendor: value.vendor ?? null,
      vehicle_id: value.vehicleId ?? null,
      location_id: value.locationId ?? null,
      method: value.method,
      paid_from: value.paidFrom,
      spread: value.spread,
      note: value.note ?? null,
      created_by: session.userId,
    })
    .select("id")
    .single();
  if (error || !data) return { error: "failed" };
  await audit({ actorUserId: session.userId, actorType: "STAFF", action: "finance.recurring_added", entityType: "fin_recurring", entityId: data.id, metadata: { by: session.displayName, name: value.name, category: value.category, amountCents, everyMonths: value.everyMonths, startsOn: value.startsOn, endsOn: value.endsOn ?? null, vendor: value.vendor ?? null, vehicleId: value.vehicleId ?? null, locationId: value.locationId ?? null, method: value.method, paidFrom: value.paidFrom, spread: value.spread } });
  refresh();
  return { ok: true };
}

async function usage(id: string) {
  const supabase = createAdminClient();
  const [linked, skipped] = await Promise.all([
    supabase.from("expenses").select("id", { count: "exact", head: true }).eq("recurring_id", id),
    supabase.from("fin_recurring_skips").select("recurring_id", { count: "exact", head: true }).eq("recurring_id", id),
  ]);
  if (linked.error || skipped.error) return null;
  return (linked.count ?? 0) + (skipped.count ?? 0);
}

export async function stopRecurring(_: RecurringState, form: FormData): Promise<RecurringState> {
  const session = await requirePermission("finance.review");
  const id = z.uuid().safeParse(form.get("id"));
  if (!id.success) return { error: "invalid" };
  const today = laToday();
  const supabase = createAdminClient();
  const { data: row } = await supabase.from("fin_recurring").select("id, name, starts_on, ends_on").eq("id", id.data).maybeSingle();
  if (!row) return { error: "gone" };
  if (row.starts_on > today) return { error: "start" };
  if (row.ends_on && row.ends_on <= today) return { ok: true };
  const { error } = await supabase.from("fin_recurring").update({ ends_on: today }).eq("id", row.id);
  if (error) return { error: "failed" };
  await audit({ actorUserId: session.userId, actorType: "STAFF", action: "finance.recurring_stopped", entityType: "fin_recurring", entityId: row.id, metadata: { by: session.displayName, name: row.name, endsOn: today, previousEndsOn: row.ends_on } });
  refresh();
  return { ok: true };
}

export async function deleteRecurring(_: RecurringState, form: FormData): Promise<RecurringState> {
  const session = await requirePermission("finance.review");
  const id = z.uuid().safeParse(form.get("id"));
  if (!id.success) return { error: "invalid" };
  const supabase = createAdminClient();
  const { data: row } = await supabase.from("fin_recurring").select("id, name, category, amount_cents, every_months, starts_on, ends_on").eq("id", id.data).maybeSingle();
  if (!row) return { error: "gone" };
  const count = await usage(row.id);
  if (count === null) return { error: "failed" };
  if (count > 0) return { error: "used" };
  const { error } = await supabase.from("fin_recurring").delete().eq("id", row.id);
  if (error) return { error: error.code === "23503" ? "used" : "failed" };
  await audit({ actorUserId: session.userId, actorType: "STAFF", action: "finance.recurring_deleted", entityType: "fin_recurring", entityId: row.id, metadata: { by: session.displayName, name: row.name, category: row.category, amountCents: row.amount_cents, everyMonths: row.every_months, startsOn: row.starts_on, endsOn: row.ends_on } });
  refresh();
  return { ok: true };
}

const occurrenceInput = z.object({ recurringId: z.uuid(), dueOn: day });

async function dueTemplate(recurringId: string, dueOn: string, today: string) {
  const supabase = createAdminClient();
  const { data: row } = await supabase.from("fin_recurring").select("id, name, category, amount_cents, every_months, starts_on, ends_on, vendor, vehicle_id, location_id, method, paid_from, spread, note").eq("id", recurringId).maybeSingle();
  if (!row || !isDue(row, dueOn, today)) return null;
  const { data: skipped } = await supabase.from("fin_recurring_skips").select("due_on").eq("recurring_id", row.id).eq("due_on", dueOn).maybeSingle();
  return skipped ? null : row;
}

export async function confirmRecurring(input: { recurringId: string; dueOn: string; spentOn: string; amount: string }): Promise<RecurringState> {
  const session = await requirePermission("finance.review");
  const parsed = occurrenceInput.extend({ spentOn: day, amount: money }).safeParse({ recurringId: input.recurringId, dueOn: input.dueOn, spentOn: input.spentOn, amount: dollars(input.amount) });
  if (!parsed.success) return { error: "invalid" };
  const value = parsed.data;
  const today = laToday();
  if (value.spentOn > today) return { error: "future" };
  const row = await dueTemplate(value.recurringId, value.dueOn, today);
  if (!row) return { error: "gone" };
  const period = row.spread ? coverage(row, value.dueOn) : null;
  const vendorId = await vendorIdFor(row.vendor);
  const amountCents = Math.round(value.amount * 100);
  const { data, error } = await createAdminClient()
    .from("expenses")
    .insert({
      spent_on: value.spentOn,
      category: row.category,
      amount_cents: amountCents,
      vendor: row.vendor,
      vehicle_id: row.vehicle_id,
      location_id: row.location_id,
      method: row.method,
      paid_from: row.paid_from,
      service_from: period?.from ?? null,
      service_to: period?.to ?? null,
      capital: false,
      note: row.note,
      recurring_id: row.id,
      recurring_on: value.dueOn,
      vendor_id: vendorId,
      created_by: session.userId,
    })
    .select("id")
    .single();
  if (error?.code === "23505") return { error: "taken" };
  if (error || !data) return { error: "failed" };
  await audit({ actorUserId: session.userId, actorType: "STAFF", action: "expense.recorded", entityType: "expense", entityId: data.id, metadata: { by: session.displayName, spentOn: value.spentOn, category: row.category, amountCents, vendor: row.vendor, vehicleId: row.vehicle_id, locationId: row.location_id, method: row.method, paidFrom: row.paid_from, serviceFrom: period?.from ?? null, serviceTo: period?.to ?? null, capital: false, recurringId: row.id, dueOn: value.dueOn, vendorId } });
  return { ok: true, expenseId: data.id };
}

export async function skipRecurring(input: { recurringId: string; dueOn: string }): Promise<RecurringState> {
  const session = await requirePermission("finance.review");
  const parsed = occurrenceInput.safeParse(input);
  if (!parsed.success) return { error: "invalid" };
  const value = parsed.data;
  const row = await dueTemplate(value.recurringId, value.dueOn, laToday());
  if (!row) return { error: "gone" };
  const supabase = createAdminClient();
  const { count, error: countError } = await supabase.from("expenses").select("id", { count: "exact", head: true }).eq("recurring_id", row.id).eq("recurring_on", value.dueOn).is("voided_at", null);
  if (countError) return { error: "failed" };
  if ((count ?? 0) > 0) return { error: "taken" };
  const { error } = await supabase.from("fin_recurring_skips").insert({ recurring_id: row.id, due_on: value.dueOn, skipped_by: session.userId });
  if (error && error.code !== "23505") return { error: "failed" };
  await audit({ actorUserId: session.userId, actorType: "STAFF", action: "finance.recurring_skipped", entityType: "fin_recurring", entityId: row.id, metadata: { by: session.displayName, name: row.name, dueOn: value.dueOn, amountCents: row.amount_cents } });
  refresh();
  return { ok: true };
}

const settlementInput = z.object({
  kind: z.enum(settlementKinds),
  paidOn: day,
  amount: money,
  reference: z.string().max(160).optional(),
  note: z.string().max(1000).optional(),
});

export async function addSettlement(_: RecurringState, form: FormData): Promise<RecurringState> {
  const session = await requirePermission("finance.review");
  const parsed = settlementInput.safeParse({
    kind: form.get("kind"),
    paidOn: trimmed(form.get("paidOn")),
    amount: dollars(form.get("amount")),
    reference: trimmed(form.get("reference")) || undefined,
    note: trimmed(form.get("note")) || undefined,
  });
  if (!parsed.success) return { error: "invalid" };
  const value = parsed.data;
  if (value.paidOn > laToday()) return { error: "future" };
  const amountCents = Math.round(value.amount * 100);
  const { data, error } = await createAdminClient()
    .from("fin_settlements")
    .insert({ kind: value.kind, paid_on: value.paidOn, amount_cents: amountCents, reference: value.reference ?? null, note: value.note ?? null, created_by: session.userId })
    .select("id")
    .single();
  if (error || !data) return { error: "failed" };
  await audit({ actorUserId: session.userId, actorType: "STAFF", action: "finance.settlement_recorded", entityType: "fin_settlement", entityId: data.id, metadata: { by: session.displayName, kind: value.kind, paidOn: value.paidOn, amountCents } });
  refresh();
  return { ok: true };
}

export async function voidSettlement(_: RecurringState, form: FormData): Promise<RecurringState> {
  const session = await requirePermission("finance.review");
  const parsed = z.object({ id: z.uuid(), reason: z.string().trim().min(2).max(500) }).safeParse({ id: form.get("id"), reason: trimmed(form.get("reason")) });
  if (!parsed.success) return { error: parsed.error.issues.some((issue) => issue.path[0] === "reason") ? "reason" : "invalid" };
  const { data, error } = await createAdminClient().from("fin_settlements").update({ voided_at: new Date().toISOString(), voided_by: session.userId, void_reason: parsed.data.reason }).eq("id", parsed.data.id).is("voided_at", null).select("id, kind, amount_cents, paid_on");
  if (error) return { error: "failed" };
  if (!data?.length) return { error: "status" };
  await audit({ actorUserId: session.userId, actorType: "STAFF", action: "finance.settlement_voided", entityType: "fin_settlement", entityId: parsed.data.id, metadata: { by: session.displayName, reason: parsed.data.reason, kind: data[0].kind, amountCents: data[0].amount_cents, paidOn: data[0].paid_on } });
  refresh();
  return { ok: true };
}
