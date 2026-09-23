"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { requirePermission } from "@/lib/auth/staff";
import { addAdjustment, adjustmentKinds, createMonthlyStatements, isMonthKey, issueStatement, removeAdjustment, rereadStatement, resolveDispute, setReading, voidStatement } from "./mileage";

export type MileageState = { ok?: boolean; error?: string; created?: number; issued?: number; drafts?: number };

const uuid = z.uuid();
const trimmed = (value: FormDataEntryValue | null) => String(value ?? "").trim();
const integer = (value: FormDataEntryValue | null) => Number(trimmed(value).replace(/[,\s]/g, ""));

function refresh() {
  revalidatePath("/ops/investors", "layout");
}

async function actor(permission: "investor.finance" | "investor.manage" = "investor.finance") {
  const session = await requirePermission(permission);
  return { userId: session.userId, displayName: session.displayName };
}

export async function generateStatements(_: MileageState, form: FormData): Promise<MileageState> {
  const staff = await actor();
  const month = form.get("month");
  if (!isMonthKey(month)) return { error: "invalid" };
  const result = await createMonthlyStatements(month);
  await audit({ actorUserId: staff.userId, actorType: "STAFF", action: "investor.statements_generated", entityType: "investor_mileage_statement", metadata: { by: staff.displayName, ...result } });
  refresh();
  return { ok: true, created: result.created, issued: result.issued, drafts: result.drafts };
}

export async function rereadOdometer(_: MileageState, form: FormData): Promise<MileageState> {
  const staff = await actor();
  const id = uuid.safeParse(form.get("id"));
  if (!id.success) return { error: "invalid" };
  const result = await rereadStatement(id.data, staff);
  refresh();
  return "error" in result ? { error: result.error } : { ok: true };
}

export async function enterReading(_: MileageState, form: FormData): Promise<MileageState> {
  const staff = await actor();
  const parsed = z.object({ id: uuid, which: z.enum(["start", "end"]), reading: z.number().int().min(0).max(2000000) }).safeParse({ id: form.get("id"), which: form.get("which"), reading: integer(form.get("reading")) });
  if (!parsed.success) return { error: "invalid" };
  const result = await setReading(parsed.data.id, parsed.data.which, parsed.data.reading, "MANUAL", staff);
  refresh();
  return "error" in result ? { error: result.error } : { ok: true };
}

export async function addStatementAdjustment(_: MileageState, form: FormData): Promise<MileageState> {
  const staff = await actor();
  const parsed = z
    .object({ id: uuid, miles: z.number().int().refine((value) => value !== 0 && Math.abs(value) <= 100000), kind: z.enum(adjustmentKinds), reason: z.string().trim().min(2).max(500) })
    .safeParse({ id: form.get("id"), miles: integer(form.get("miles")), kind: form.get("kind"), reason: trimmed(form.get("reason")) });
  if (!parsed.success) return { error: "invalid" };
  const result = await addAdjustment(parsed.data.id, { miles: parsed.data.miles, kind: parsed.data.kind, reason: parsed.data.reason }, staff);
  refresh();
  return "error" in result ? { error: result.error } : { ok: true };
}

export async function removeStatementAdjustment(_: MileageState, form: FormData): Promise<MileageState> {
  const staff = await actor();
  const id = uuid.safeParse(form.get("id"));
  if (!id.success) return { error: "invalid" };
  const result = await removeAdjustment(id.data, staff);
  refresh();
  return "error" in result ? { error: result.error } : { ok: true };
}

export async function issueStatementAction(_: MileageState, form: FormData): Promise<MileageState> {
  const staff = await actor();
  const id = uuid.safeParse(form.get("id"));
  if (!id.success) return { error: "invalid" };
  const statement = await issueStatement(id.data, staff);
  refresh();
  return statement?.status === "ISSUED" ? { ok: true } : { error: "status" };
}

export async function voidStatementAction(_: MileageState, form: FormData): Promise<MileageState> {
  const staff = await actor();
  const id = uuid.safeParse(form.get("id"));
  if (!id.success) return { error: "invalid" };
  const result = await voidStatement(id.data, staff);
  refresh();
  return "error" in result ? { error: result.error } : { ok: true };
}

export async function resolveStatementDispute(_: MileageState, form: FormData): Promise<MileageState> {
  const staff = await actor();
  const parsed = z.object({ id: uuid, accepted: z.number().int().min(0).max(1000000), note: z.string().trim().min(2).max(1000) }).safeParse({ id: form.get("id"), accepted: integer(form.get("accepted")), note: trimmed(form.get("note")) });
  if (!parsed.success) return { error: "invalid" };
  const result = await resolveDispute(parsed.data.id, parsed.data.accepted, parsed.data.note, staff);
  refresh();
  return "error" in result ? { error: result.error } : { ok: true };
}
