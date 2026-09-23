"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { zonedParts } from "@/features/booking/time";
import { notifyInvestor } from "@/features/notifications/center";
import { audit } from "@/lib/audit";
import { requirePermission } from "@/lib/auth/staff";
import { createAdminClient } from "@/lib/supabase/admin";
import { emailSchema, findAuthUserId, nameSchema, normalizePhone, phoneSchema, sendInvestorDecision, sendInvestorPasswordEmail, sendInvestorWelcomeLinked } from "./auth-core";
import { canCloseInvestor } from "./ledger";
import { setRate } from "./mileage";
import { loadInvestorSettings } from "./settings";

export type InvestorOpsState = { ok?: boolean; error?: "invalid" | "exists" | "phone_exists" | "failed" | "balance" | "status" | "allocations"; id?: string; linked?: boolean };

const uuid = z.uuid();
const trimmed = (value: FormDataEntryValue | null) => String(value ?? "").trim();

function refresh(id?: string) {
  revalidatePath("/ops/investors");
  if (id) revalidatePath(`/ops/investors/${id}`);
}

const createInput = z.object({
  legalName: nameSchema,
  email: emailSchema,
  phone: phoneSchema,
  language: z.enum(["zh", "en"]),
  notes: z.string().trim().max(2000).optional(),
  defaultShare: z.number().min(0).max(100).nullable(),
  compensation: z.enum(["REVENUE_SHARE", "PER_MILE"]),
  mileageRate: z.number().min(0).max(100).nullable(),
  payoutDays: z.number().int().min(0).max(60).nullable(),
});

const shareOf = (value: FormDataEntryValue | null) => {
  const text = trimmed(value).replace(/[%\s]/g, "");
  return text === "" ? null : Number(text);
};

const numberOf = (value: FormDataEntryValue | null) => {
  const text = trimmed(value).replace(/[$,\s]/g, "");
  return text === "" ? null : Number(text);
};

const currentMonth = () => zonedParts(new Date(), "America/Los_Angeles").date.slice(0, 7);

const compensationFields = (form: FormData) => ({ compensation: form.get("compensation") ?? "REVENUE_SHARE", mileageRate: numberOf(form.get("mileageRate")), payoutDays: numberOf(form.get("payoutDays")) });

export async function createInvestor(_: InvestorOpsState, form: FormData): Promise<InvestorOpsState> {
  const session = await requirePermission("investor.manage");
  const parsed = createInput.safeParse({ legalName: trimmed(form.get("legalName")), email: trimmed(form.get("email")).toLowerCase(), phone: trimmed(form.get("phone")), language: form.get("language"), notes: trimmed(form.get("notes")), defaultShare: shareOf(form.get("defaultShare")), ...compensationFields(form) });
  if (!parsed.success) return { error: "invalid" };
  const admin = createAdminClient();
  const [{ data: byEmail }, { data: byPhone }] = await Promise.all([
    admin.from("investors").select("id").eq("email", parsed.data.email).maybeSingle(),
    admin.from("investors").select("id").eq("phone_normalized", normalizePhone(parsed.data.phone)).maybeSingle(),
  ]);
  if (byEmail) return { error: "exists" };
  if (byPhone) return { error: "phone_exists" };

  const created = await admin.auth.admin.createUser({ email: parsed.data.email, password: randomBytes(24).toString("base64url"), email_confirm: true });
  let userId = created.data.user?.id;
  const linked = Boolean(created.error || !userId);
  if (linked) {
    userId = (await findAuthUserId(parsed.data.email)) ?? undefined;
    if (!userId) return { error: "failed" };
  }
  const { data: investor, error } = await admin
    .from("investors")
    .insert({
      auth_user_id: userId,
      legal_name: parsed.data.legalName,
      email: parsed.data.email,
      phone: parsed.data.phone,
      preferred_language: parsed.data.language,
      status: "ACTIVE",
      notes: parsed.data.notes || null,
      default_share_bps: parsed.data.defaultShare === null ? null : Math.round(parsed.data.defaultShare * 100),
      compensation: parsed.data.compensation,
      mileage_payout_days: parsed.data.compensation === "PER_MILE" ? parsed.data.payoutDays : null,
      reviewed_by: session.userId,
      reviewed_at: new Date().toISOString(),
      created_by: session.userId,
    })
    .select("id")
    .single();
  if (error || !investor) {
    if (!linked && created.data.user) await admin.auth.admin.deleteUser(created.data.user.id).catch(() => undefined);
    return { error: /phone/.test(error?.message ?? "") ? "phone_exists" : "failed" };
  }
  await audit({ actorUserId: session.userId, actorType: "STAFF", action: "investor.created", entityType: "investor", entityId: investor.id, metadata: { by: session.displayName, email: parsed.data.email, linked, compensation: parsed.data.compensation } });
  if (parsed.data.compensation === "PER_MILE" && parsed.data.mileageRate !== null) await setRate(investor.id, Math.round(parsed.data.mileageRate * 100), currentMonth(), { userId: session.userId, displayName: session.displayName });
  if (linked) await sendInvestorWelcomeLinked(parsed.data.email, parsed.data.language);
  else await sendInvestorPasswordEmail(parsed.data.email, parsed.data.language, "welcome");
  refresh();
  redirect(`/investors/${investor.id}?created=1`);
}

export async function reviewInvestor(_: InvestorOpsState, form: FormData): Promise<InvestorOpsState> {
  const session = await requirePermission("investor.manage");
  const parsed = z.object({ id: uuid, decision: z.enum(["approve", "reject"]), note: z.string().trim().max(1000).optional() }).safeParse({ id: form.get("id"), decision: form.get("decision"), note: trimmed(form.get("note")) });
  if (!parsed.success) return { error: "invalid" };
  const admin = createAdminClient();
  const { data: investor } = await admin.from("investors").select("id, status, legal_name, email, preferred_language").eq("id", parsed.data.id).maybeSingle();
  if (!investor || investor.status !== "PENDING") return { error: "status" };
  const approved = parsed.data.decision === "approve";
  const { error } = await admin
    .from("investors")
    .update({ status: approved ? "ACTIVE" : "REJECTED", reviewed_by: session.userId, reviewed_at: new Date().toISOString(), review_note: parsed.data.note || null })
    .eq("id", investor.id)
    .eq("status", "PENDING");
  if (error) return { error: "failed" };
  await audit({ actorUserId: session.userId, actorType: "STAFF", action: approved ? "investor.approved" : "investor.rejected", entityType: "investor", entityId: investor.id, metadata: { by: session.displayName, note: parsed.data.note || null } });
  await sendInvestorDecision(investor, approved ? "approved" : "rejected", parsed.data.note);
  if (approved) await notifyInvestor(investor.id, { kind: "account_approved", href: "/", dedupeKey: `account_approved:${investor.id}` });
  refresh(investor.id);
  return { ok: true };
}

export async function setInvestorStatus(_: InvestorOpsState, form: FormData): Promise<InvestorOpsState> {
  const session = await requirePermission("investor.manage");
  const parsed = z.object({ id: uuid, status: z.enum(["ACTIVE", "SUSPENDED", "CLOSED"]), note: z.string().trim().max(1000).optional() }).safeParse({ id: form.get("id"), status: form.get("status"), note: trimmed(form.get("note")) });
  if (!parsed.success) return { error: "invalid" };
  const admin = createAdminClient();
  const { data: investor } = await admin.from("investors").select("id, status").eq("id", parsed.data.id).maybeSingle();
  if (!investor) return { error: "invalid" };
  const allowed: Record<string, string[]> = { ACTIVE: ["SUSPENDED", "CLOSED"], SUSPENDED: ["ACTIVE", "CLOSED"], REJECTED: ["ACTIVE"], PENDING: [] };
  if (!(allowed[investor.status] ?? []).includes(parsed.data.status)) return { error: "status" };
  if (parsed.data.status === "CLOSED" && !(await canCloseInvestor(investor.id))) return { error: "balance" };
  const { error } = await admin.from("investors").update({ status: parsed.data.status, review_note: parsed.data.note || null, reviewed_by: session.userId, reviewed_at: new Date().toISOString() }).eq("id", investor.id);
  if (error) return { error: "failed" };
  await audit({ actorUserId: session.userId, actorType: "STAFF", action: `investor.status_${parsed.data.status.toLowerCase()}`, entityType: "investor", entityId: investor.id, metadata: { by: session.displayName, from: investor.status, note: parsed.data.note || null } });
  refresh(investor.id);
  return { ok: true };
}

const profileInput = z.object({ id: uuid, house: z.boolean(), legalName: nameSchema, phone: phoneSchema, language: z.enum(["zh", "en"]), notes: z.string().trim().max(4000).optional(), defaultShare: z.number().min(0).max(100).nullable(), compensation: z.enum(["REVENUE_SHARE", "PER_MILE"]), mileageRate: z.number().min(0).max(100).nullable(), payoutDays: z.number().int().min(0).max(60).nullable(), rateMonth: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional() });

export async function updateInvestorProfile(_: InvestorOpsState, form: FormData): Promise<InvestorOpsState> {
  const session = await requirePermission("investor.manage");
  const parsed = profileInput.safeParse({ id: form.get("id"), house: form.get("house") === "on", legalName: trimmed(form.get("legalName")), phone: trimmed(form.get("phone")), language: form.get("language"), notes: trimmed(form.get("notes")), defaultShare: shareOf(form.get("defaultShare")), ...compensationFields(form), rateMonth: trimmed(form.get("rateMonth")) || undefined });
  if (!parsed.success) return { error: "invalid" };
  const admin = createAdminClient();
  const [{ data: byPhone }, { data: current }] = await Promise.all([
    admin.from("investors").select("id").eq("phone_normalized", normalizePhone(parsed.data.phone)).neq("id", parsed.data.id).maybeSingle(),
    admin.from("investors").select("compensation").eq("id", parsed.data.id).maybeSingle(),
  ]);
  if (byPhone) return { error: "phone_exists" };
  if (!current) return { error: "invalid" };
  if (current.compensation !== parsed.data.compensation) {
    const { count } = await admin.from("investor_allocations").select("id", { count: "exact", head: true }).eq("investor_id", parsed.data.id).in("status", ["ACTIVE", "EXITING"]);
    if (count) return { error: "allocations" };
  }
  const perMile = parsed.data.compensation === "PER_MILE";
  const { error } = await admin.from("investors").update({ legal_name: parsed.data.legalName, phone: parsed.data.phone, preferred_language: parsed.data.language, notes: parsed.data.notes || null, default_share_bps: parsed.data.defaultShare === null ? null : Math.round(parsed.data.defaultShare * 100), compensation: parsed.data.compensation, mileage_payout_days: perMile ? parsed.data.payoutDays : null, house: parsed.data.house }).eq("id", parsed.data.id);
  if (error) return { error: "failed" };
  if (perMile) {
    if (parsed.data.mileageRate !== null) await setRate(parsed.data.id, Math.round(parsed.data.mileageRate * 100), parsed.data.rateMonth ?? currentMonth(), { userId: session.userId, displayName: session.displayName });
  } else {
    const shareBps = parsed.data.defaultShare === null ? (await loadInvestorSettings()).revenueShareBps : Math.round(parsed.data.defaultShare * 100);
    await admin.from("investor_allocations").update({ revenue_share_bps: shareBps }).eq("investor_id", parsed.data.id).in("status", ["ACTIVE", "EXITING"]);
  }
  await audit({ actorUserId: session.userId, actorType: "STAFF", action: "investor.profile_updated", entityType: "investor", entityId: parsed.data.id, metadata: { by: session.displayName, compensation: parsed.data.compensation } });
  refresh(parsed.data.id);
  return { ok: true };
}

export async function sendInvestorReset(_: InvestorOpsState, form: FormData): Promise<InvestorOpsState> {
  const session = await requirePermission("investor.manage");
  const parsed = uuid.safeParse(form.get("id"));
  if (!parsed.success) return { error: "invalid" };
  const { data: investor } = await createAdminClient().from("investors").select("id, email, preferred_language").eq("id", parsed.data).maybeSingle();
  if (!investor) return { error: "invalid" };
  const sent = await sendInvestorPasswordEmail(investor.email, investor.preferred_language === "en" ? "en" : "zh", "reset");
  if (!sent) return { error: "failed" };
  await audit({ actorUserId: session.userId, actorType: "STAFF", action: "investor.password_email_sent", entityType: "investor", entityId: investor.id, metadata: { by: session.displayName } });
  return { ok: true };
}
