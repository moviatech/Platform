"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { notifyInvestor } from "@/features/notifications/center";
import { audit } from "@/lib/audit";
import { requirePermission } from "@/lib/auth/staff";
import { createAdminClient } from "@/lib/supabase/admin";
import { emailSchema, findAuthUserId, nameSchema, normalizePhone, phoneSchema, sendInvestorDecision, sendInvestorPasswordEmail, sendInvestorWelcomeLinked } from "./auth-core";
import { canCloseInvestor } from "./ledger";

export type InvestorOpsState = { ok?: boolean; error?: "invalid" | "exists" | "phone_exists" | "failed" | "balance" | "status"; id?: string; linked?: boolean };

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
});

export async function createInvestor(_: InvestorOpsState, form: FormData): Promise<InvestorOpsState> {
  const session = await requirePermission("investor.manage");
  const parsed = createInput.safeParse({ legalName: trimmed(form.get("legalName")), email: trimmed(form.get("email")).toLowerCase(), phone: trimmed(form.get("phone")), language: form.get("language"), notes: trimmed(form.get("notes")) });
  if (!parsed.success) return { error: "invalid" };
  const admin = createAdminClient();
  const [{ data: byEmail }, { data: byPhone }] = await Promise.all([
    admin.from("investors").select("id").ilike("email", parsed.data.email).maybeSingle(),
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
  await audit({ actorUserId: session.userId, actorType: "STAFF", action: "investor.created", entityType: "investor", entityId: investor.id, metadata: { by: session.displayName, email: parsed.data.email, linked } });
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

const profileInput = z.object({ id: uuid, legalName: nameSchema, phone: phoneSchema, language: z.enum(["zh", "en"]), notes: z.string().trim().max(4000).optional() });

export async function updateInvestorProfile(_: InvestorOpsState, form: FormData): Promise<InvestorOpsState> {
  const session = await requirePermission("investor.manage");
  const parsed = profileInput.safeParse({ id: form.get("id"), legalName: trimmed(form.get("legalName")), phone: trimmed(form.get("phone")), language: form.get("language"), notes: trimmed(form.get("notes")) });
  if (!parsed.success) return { error: "invalid" };
  const admin = createAdminClient();
  const { data: byPhone } = await admin.from("investors").select("id").eq("phone_normalized", normalizePhone(parsed.data.phone)).neq("id", parsed.data.id).maybeSingle();
  if (byPhone) return { error: "phone_exists" };
  const { error } = await admin.from("investors").update({ legal_name: parsed.data.legalName, phone: parsed.data.phone, preferred_language: parsed.data.language, notes: parsed.data.notes || null }).eq("id", parsed.data.id);
  if (error) return { error: "failed" };
  await audit({ actorUserId: session.userId, actorType: "STAFF", action: "investor.profile_updated", entityType: "investor", entityId: parsed.data.id, metadata: { by: session.displayName } });
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
