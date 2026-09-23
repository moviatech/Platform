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
import { loadMemberPosition } from "./members";
import { setRate } from "./mileage";
import { loadInvestorSettings } from "./settings";

export type InvestorOpsState = { ok?: boolean; error?: "invalid" | "exists" | "phone_exists" | "failed" | "balance" | "status" | "allocations" | "company" | "has_money" | "has_stake" | "has_members" | "stake" | "overdrawn"; id?: string; linked?: boolean };

const memberAvailable = async (companyId: string) => {
  const { data } = await createAdminClient().from("investor_member_balances").select("member_id, available_cents").eq("company_id", companyId);
  return new Map(((data ?? []) as Array<{ member_id: string; available_cents: number }>).map((row) => [row.member_id, row.available_cents]));
};

const overdraws = (before: Map<string, number>, after: Map<string, number>) => [...after].some(([member, cents]) => cents < 0 && cents < (before.get(member) ?? 0));

const guardError = (message: string | undefined): InvestorOpsState["error"] | null => {
  if (/investor_company_invalid/.test(message ?? "")) return "company";
  if (/investor_member_has_money/.test(message ?? "")) return "has_money";
  if (/investor_member_has_stake/.test(message ?? "")) return "has_stake";
  if (/investor_company_has_members/.test(message ?? "")) return "has_members";
  return null;
};

const today = () => zonedParts(new Date(), "America/Los_Angeles").date;
const dateSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/);

const uuid = z.uuid();
const trimmed = (value: FormDataEntryValue | null) => String(value ?? "").trim();

function refresh(id?: string) {
  revalidatePath("/ops/investors");
  if (id) revalidatePath(`/ops/investors/${id}`);
}

const createInput = z.object({
  kind: z.enum(["INDIVIDUAL", "COMPANY"]),
  companyId: uuid.nullable(),
  stakeAmount: z.number().positive().max(1_000_000_000).nullable(),
  stakeDate: dateSchema.nullable(),
  legalName: nameSchema,
  email: emailSchema.nullable(),
  phone: phoneSchema.nullable(),
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
  const parsed = createInput.safeParse({
    kind: form.get("kind") ?? "INDIVIDUAL",
    companyId: trimmed(form.get("companyId")) || null,
    stakeAmount: numberOf(form.get("stakeAmount")),
    stakeDate: trimmed(form.get("stakeDate")) || null,
    legalName: trimmed(form.get("legalName")),
    email: trimmed(form.get("email")).toLowerCase() || null,
    phone: trimmed(form.get("phone")) || null,
    language: form.get("language"),
    notes: trimmed(form.get("notes")),
    defaultShare: shareOf(form.get("defaultShare")),
    ...compensationFields(form),
  });
  if (!parsed.success) return { error: "invalid" };
  const company = parsed.data.kind === "COMPANY";
  const companyId = company ? null : parsed.data.companyId;
  const { email, phone } = parsed.data;
  if (!company && (!email || !phone)) return { error: "invalid" };
  if (company && parsed.data.companyId) return { error: "invalid" };
  if (company && !email && parsed.data.compensation === "PER_MILE") return { error: "invalid" };
  const admin = createAdminClient();
  if (companyId) {
    const { data: parent } = await admin.from("investors").select("id").eq("id", companyId).eq("kind", "COMPANY").eq("compensation", "REVENUE_SHARE").is("company_id", null).maybeSingle();
    if (!parent) return { error: "company" };
  }
  const [{ data: byEmail }, { data: byPhone }] = await Promise.all([
    email ? admin.from("investors").select("id").eq("email", email).maybeSingle() : Promise.resolve({ data: null }),
    phone ? admin.from("investors").select("id").eq("phone_normalized", normalizePhone(phone)).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  if (byEmail) return { error: "exists" };
  if (byPhone) return { error: "phone_exists" };

  let userId: string | undefined;
  let linked = false;
  let createdUserId: string | undefined;
  if (email) {
    const created = await admin.auth.admin.createUser({ email, password: randomBytes(24).toString("base64url"), email_confirm: true });
    userId = created.data.user?.id;
    createdUserId = userId;
    linked = Boolean(created.error || !userId);
    if (linked) {
      userId = (await findAuthUserId(email)) ?? undefined;
      if (!userId) return { error: "failed" };
    }
  }
  const compensation = companyId ? "REVENUE_SHARE" : parsed.data.compensation;
  const { data: investor, error } = await admin
    .from("investors")
    .insert({
      auth_user_id: userId ?? null,
      kind: parsed.data.kind,
      company_id: companyId,
      legal_name: parsed.data.legalName,
      email,
      phone,
      preferred_language: parsed.data.language,
      status: "ACTIVE",
      notes: parsed.data.notes || null,
      default_share_bps: companyId || parsed.data.defaultShare === null ? null : Math.round(parsed.data.defaultShare * 100),
      compensation,
      mileage_payout_days: compensation === "PER_MILE" ? parsed.data.payoutDays : null,
      reviewed_by: session.userId,
      reviewed_at: new Date().toISOString(),
      created_by: session.userId,
    })
    .select("id")
    .single();
  if (error || !investor) {
    if (!linked && createdUserId) await admin.auth.admin.deleteUser(createdUserId).catch(() => undefined);
    return { error: guardError(error?.message) ?? (/phone/.test(error?.message ?? "") ? "phone_exists" : "failed") };
  }
  await audit({ actorUserId: session.userId, actorType: "STAFF", action: "investor.created", entityType: "investor", entityId: investor.id, metadata: { by: session.displayName, email, linked, compensation, kind: parsed.data.kind, companyId } });
  if (companyId && parsed.data.stakeAmount !== null) {
    const amountCents = Math.round(parsed.data.stakeAmount * 100);
    const effectiveOn = parsed.data.stakeDate ?? today();
    const before = await memberAvailable(companyId);
    let { data: stake } = await admin.from("investor_stakes").insert({ company_id: companyId, member_id: investor.id, amount_cents: amountCents, effective_on: effectiveOn, created_by: session.userId }).select("id").single();
    if (stake && overdraws(before, await memberAvailable(companyId))) {
      await admin.from("investor_stakes").delete().eq("id", stake.id);
      stake = null;
    }
    if (stake) await audit({ actorUserId: session.userId, actorType: "STAFF", action: "investor.stake_added", entityType: "investor", entityId: investor.id, metadata: { by: session.displayName, companyId, amountCents, effectiveOn } });
  }
  if (compensation === "PER_MILE" && parsed.data.mileageRate !== null) await setRate(investor.id, Math.round(parsed.data.mileageRate * 100), currentMonth(), { userId: session.userId, displayName: session.displayName });
  if (email && linked) await sendInvestorWelcomeLinked(email, parsed.data.language);
  else if (email) await sendInvestorPasswordEmail(email, parsed.data.language, "welcome");
  refresh(companyId ?? undefined);
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
  const { data: investor } = await admin.from("investors").select("id, status, company_id").eq("id", parsed.data.id).maybeSingle();
  if (!investor) return { error: "invalid" };
  const allowed: Record<string, string[]> = { ACTIVE: ["SUSPENDED", "CLOSED"], SUSPENDED: ["ACTIVE", "CLOSED"], REJECTED: ["ACTIVE"], PENDING: [] };
  if (!(allowed[investor.status] ?? []).includes(parsed.data.status)) return { error: "status" };
  if (parsed.data.status === "CLOSED" && investor.company_id) {
    const position = await loadMemberPosition(investor.id, investor.company_id);
    const { count: upcoming } = await admin.from("investor_stakes").select("id", { count: "exact", head: true }).eq("member_id", investor.id).is("voided_at", null).gt("effective_on", today());
    if (upcoming || position.stakeCents !== 0 || position.availableCents !== 0 || position.pendingCents !== 0 || position.heldCents !== 0) return { error: "balance" };
  } else if (parsed.data.status === "CLOSED" && !(await canCloseInvestor(investor.id))) return { error: "balance" };
  const { error } = await admin.from("investors").update({ status: parsed.data.status, review_note: parsed.data.note || null, reviewed_by: session.userId, reviewed_at: new Date().toISOString() }).eq("id", investor.id);
  if (error) return { error: "failed" };
  await audit({ actorUserId: session.userId, actorType: "STAFF", action: `investor.status_${parsed.data.status.toLowerCase()}`, entityType: "investor", entityId: investor.id, metadata: { by: session.displayName, from: investor.status, note: parsed.data.note || null } });
  refresh(investor.id);
  return { ok: true };
}

const profileInput = z.object({ id: uuid, kind: z.enum(["INDIVIDUAL", "COMPANY"]), companyId: uuid.nullable(), house: z.boolean(), legalName: nameSchema, phone: phoneSchema.nullable(), language: z.enum(["zh", "en"]), notes: z.string().trim().max(4000).optional(), defaultShare: z.number().min(0).max(100).nullable(), compensation: z.enum(["REVENUE_SHARE", "PER_MILE"]), mileageRate: z.number().min(0).max(100).nullable(), payoutDays: z.number().int().min(0).max(60).nullable(), rateMonth: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional() });

export async function updateInvestorProfile(_: InvestorOpsState, form: FormData): Promise<InvestorOpsState> {
  const session = await requirePermission("investor.manage");
  const parsed = profileInput.safeParse({ id: form.get("id"), kind: form.get("kind") ?? "INDIVIDUAL", companyId: trimmed(form.get("companyId")) || null, house: form.get("house") === "on", legalName: trimmed(form.get("legalName")), phone: trimmed(form.get("phone")) || null, language: form.get("language"), notes: trimmed(form.get("notes")), defaultShare: shareOf(form.get("defaultShare")), ...compensationFields(form), rateMonth: trimmed(form.get("rateMonth")) || undefined });
  if (!parsed.success) return { error: "invalid" };
  const company = parsed.data.kind === "COMPANY";
  const companyId = company ? null : parsed.data.companyId;
  const { phone } = parsed.data;
  if (!company && !phone) return { error: "invalid" };
  if (companyId === parsed.data.id) return { error: "company" };
  const admin = createAdminClient();
  const [{ data: byPhone }, { data: current }, { data: parent }] = await Promise.all([
    phone ? admin.from("investors").select("id").eq("phone_normalized", normalizePhone(phone)).neq("id", parsed.data.id).maybeSingle() : Promise.resolve({ data: null }),
    admin.from("investors").select("compensation, company_id, email").eq("id", parsed.data.id).maybeSingle(),
    companyId ? admin.from("investors").select("id").eq("id", companyId).eq("kind", "COMPANY").eq("compensation", "REVENUE_SHARE").is("company_id", null).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  if (byPhone) return { error: "phone_exists" };
  if (!current) return { error: "invalid" };
  if (!company && !current.email) return { error: "invalid" };
  if (companyId && !parent) return { error: "company" };
  const compensation = companyId ? "REVENUE_SHARE" : parsed.data.compensation;
  if (company && compensation === "PER_MILE" && !current.email) return { error: "invalid" };
  if (current.compensation !== compensation) {
    const { count } = await admin.from("investor_allocations").select("id", { count: "exact", head: true }).eq("investor_id", parsed.data.id).in("status", ["ACTIVE", "EXITING"]);
    if (count) return { error: "allocations" };
  }
  const perMile = compensation === "PER_MILE";
  const { error } = await admin
    .from("investors")
    .update({
      kind: parsed.data.kind,
      company_id: companyId,
      legal_name: parsed.data.legalName,
      phone,
      preferred_language: parsed.data.language,
      notes: parsed.data.notes || null,
      default_share_bps: companyId || parsed.data.defaultShare === null ? null : Math.round(parsed.data.defaultShare * 100),
      compensation,
      mileage_payout_days: perMile ? parsed.data.payoutDays : null,
      house: companyId ? false : parsed.data.house,
    })
    .eq("id", parsed.data.id);
  if (error) return { error: guardError(error.message) ?? "failed" };
  if (perMile) {
    if (parsed.data.mileageRate !== null) await setRate(parsed.data.id, Math.round(parsed.data.mileageRate * 100), parsed.data.rateMonth ?? currentMonth(), { userId: session.userId, displayName: session.displayName });
  } else if (!companyId) {
    const shareBps = parsed.data.defaultShare === null ? (await loadInvestorSettings()).revenueShareBps : Math.round(parsed.data.defaultShare * 100);
    await admin.from("investor_allocations").update({ revenue_share_bps: shareBps }).eq("investor_id", parsed.data.id).in("status", ["ACTIVE", "EXITING"]);
  }
  await audit({ actorUserId: session.userId, actorType: "STAFF", action: "investor.profile_updated", entityType: "investor", entityId: parsed.data.id, metadata: { by: session.displayName, compensation, kind: parsed.data.kind, companyId } });
  refresh(parsed.data.id);
  if (current.company_id && current.company_id !== companyId) refresh(current.company_id);
  if (companyId) refresh(companyId);
  return { ok: true };
}

const stakeTotal = async (memberId: string, skipId?: string) => {
  const { data } = await createAdminClient().from("investor_stakes").select("id, amount_cents").eq("member_id", memberId).is("voided_at", null);
  return ((data ?? []) as Array<{ id: string; amount_cents: number }>).filter((row) => row.id !== skipId).reduce((sum, row) => sum + Number(row.amount_cents), 0);
};

export async function addStake(_: InvestorOpsState, form: FormData): Promise<InvestorOpsState> {
  const session = await requirePermission("investor.manage");
  const parsed = z
    .object({ memberId: uuid, amount: z.number().refine((value) => value !== 0 && Math.abs(value) <= 1_000_000_000), effectiveOn: dateSchema, note: z.string().trim().max(500).optional() })
    .safeParse({ memberId: form.get("memberId"), amount: numberOf(form.get("amount")) ?? 0, effectiveOn: trimmed(form.get("effectiveOn")) || today(), note: trimmed(form.get("note")) });
  if (!parsed.success) return { error: "invalid" };
  const admin = createAdminClient();
  const { data: member } = await admin.from("investors").select("id, company_id, status").eq("id", parsed.data.memberId).maybeSingle();
  if (!member?.company_id) return { error: "company" };
  if (member.status === "CLOSED" || member.status === "REJECTED") return { error: "status" };
  const amountCents = Math.round(parsed.data.amount * 100);
  if ((await stakeTotal(member.id)) + amountCents < 0) return { error: "stake" };
  const before = await memberAvailable(member.company_id);
  const { data: stake, error } = await admin.from("investor_stakes").insert({ company_id: member.company_id, member_id: member.id, amount_cents: amountCents, effective_on: parsed.data.effectiveOn, note: parsed.data.note || null, created_by: session.userId }).select("id").single();
  if (error || !stake) return { error: "failed" };
  if (overdraws(before, await memberAvailable(member.company_id))) {
    await admin.from("investor_stakes").delete().eq("id", stake.id);
    return { error: "overdrawn" };
  }
  await audit({ actorUserId: session.userId, actorType: "STAFF", action: "investor.stake_added", entityType: "investor", entityId: member.id, metadata: { by: session.displayName, companyId: member.company_id, amountCents, effectiveOn: parsed.data.effectiveOn, note: parsed.data.note || null } });
  refresh(member.id);
  refresh(member.company_id);
  return { ok: true };
}

export async function attachMember(_: InvestorOpsState, form: FormData): Promise<InvestorOpsState> {
  const session = await requirePermission("investor.manage");
  const parsed = z
    .object({ companyId: uuid, memberId: uuid, stakeAmount: z.number().positive().max(1_000_000_000).nullable(), stakeDate: dateSchema.nullable() })
    .safeParse({ companyId: form.get("companyId"), memberId: form.get("memberId"), stakeAmount: numberOf(form.get("stakeAmount")), stakeDate: trimmed(form.get("stakeDate")) || null });
  if (!parsed.success) return { error: "invalid" };
  const admin = createAdminClient();
  const [{ data: company }, { data: member }] = await Promise.all([
    admin.from("investors").select("id").eq("id", parsed.data.companyId).eq("kind", "COMPANY").eq("compensation", "REVENUE_SHARE").is("company_id", null).in("status", ["PENDING", "ACTIVE", "SUSPENDED"]).maybeSingle(),
    admin.from("investors").select("id, kind, company_id, status, house").eq("id", parsed.data.memberId).maybeSingle(),
  ]);
  if (!company) return { error: "company" };
  if (!member || member.kind !== "INDIVIDUAL" || member.company_id || member.house || member.status === "CLOSED" || member.status === "REJECTED") return { error: "invalid" };
  const { data: joined, error } = await admin.from("investors").update({ company_id: company.id, compensation: "REVENUE_SHARE", default_share_bps: null, mileage_payout_days: null }).eq("id", member.id).is("company_id", null).select("id");
  if (error || !joined?.length) return { error: guardError(error?.message) ?? "failed" };
  await audit({ actorUserId: session.userId, actorType: "STAFF", action: "investor.member_attached", entityType: "investor", entityId: member.id, metadata: { by: session.displayName, companyId: company.id } });
  refresh(member.id);
  refresh(company.id);
  if (parsed.data.stakeAmount !== null) {
    const amountCents = Math.round(parsed.data.stakeAmount * 100);
    const effectiveOn = parsed.data.stakeDate ?? today();
    const before = await memberAvailable(company.id);
    const { data: stake } = await admin.from("investor_stakes").insert({ company_id: company.id, member_id: member.id, amount_cents: amountCents, effective_on: effectiveOn, created_by: session.userId }).select("id").single();
    if (!stake) return { error: "failed" };
    if (overdraws(before, await memberAvailable(company.id))) {
      await admin.from("investor_stakes").delete().eq("id", stake.id);
      return { error: "overdrawn" };
    }
    await audit({ actorUserId: session.userId, actorType: "STAFF", action: "investor.stake_added", entityType: "investor", entityId: member.id, metadata: { by: session.displayName, companyId: company.id, amountCents, effectiveOn } });
  }
  return { ok: true };
}

export async function voidStake(_: InvestorOpsState, form: FormData): Promise<InvestorOpsState> {
  const session = await requirePermission("investor.manage");
  const id = uuid.safeParse(form.get("id"));
  if (!id.success) return { error: "invalid" };
  const admin = createAdminClient();
  const { data: stake } = await admin.from("investor_stakes").select("id, company_id, member_id, amount_cents, effective_on, voided_at").eq("id", id.data).maybeSingle();
  if (!stake || stake.voided_at) return { error: "status" };
  if ((await stakeTotal(stake.member_id, stake.id)) < 0) return { error: "stake" };
  const before = await memberAvailable(stake.company_id);
  const { data } = await admin.from("investor_stakes").update({ voided_at: new Date().toISOString(), voided_by: session.userId }).eq("id", stake.id).is("voided_at", null).select("id");
  if (!data?.length) return { error: "status" };
  if (overdraws(before, await memberAvailable(stake.company_id))) {
    await admin.from("investor_stakes").update({ voided_at: null, voided_by: null }).eq("id", stake.id);
    return { error: "overdrawn" };
  }
  await audit({ actorUserId: session.userId, actorType: "STAFF", action: "investor.stake_voided", entityType: "investor", entityId: stake.member_id, metadata: { by: session.displayName, companyId: stake.company_id, amountCents: Number(stake.amount_cents), effectiveOn: stake.effective_on } });
  refresh(stake.member_id);
  refresh(stake.company_id);
  return { ok: true };
}

export async function sendInvestorReset(_: InvestorOpsState, form: FormData): Promise<InvestorOpsState> {
  const session = await requirePermission("investor.manage");
  const parsed = uuid.safeParse(form.get("id"));
  if (!parsed.success) return { error: "invalid" };
  const { data: investor } = await createAdminClient().from("investors").select("id, email, preferred_language").eq("id", parsed.data).maybeSingle();
  if (!investor?.email) return { error: "invalid" };
  const sent = await sendInvestorPasswordEmail(investor.email, investor.preferred_language === "en" ? "en" : "zh", "reset");
  if (!sent) return { error: "failed" };
  await audit({ actorUserId: session.userId, actorType: "STAFF", action: "investor.password_email_sent", entityType: "investor", entityId: investor.id, metadata: { by: session.displayName } });
  return { ok: true };
}
