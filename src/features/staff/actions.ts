"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { staffRoles, type StaffRole } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/auth/staff";
import { createAdminClient } from "@/lib/supabase/admin";

export type StaffState = { ok?: boolean; error?: "invalid" | "exists" | "self" | "failed"; password?: string; email?: string; linked?: boolean };

const tempPassword = () => randomBytes(9).toString("base64url");

const createInput = z.object({
  email: z.string().trim().toLowerCase().email().max(200),
  displayName: z.string().trim().min(1).max(80),
  jobTitle: z.string().trim().max(80).optional(),
  roles: z.array(z.enum(staffRoles)).min(1),
});

const rolesOf = (form: FormData) => Array.from(new Set(form.getAll("roles").map((value) => String(value))));

const targetInput = z.object({ userId: z.uuid() });

function refresh() {
  revalidatePath("/ops/staff");
}

export async function createStaff(_: StaffState, form: FormData): Promise<StaffState> {
  const session = await requirePermission("staff.manage");
  const parsed = createInput.safeParse({ email: form.get("email"), displayName: form.get("displayName"), jobTitle: form.get("jobTitle") ?? "", roles: rolesOf(form) });
  if (!parsed.success) return { error: "invalid" };
  const admin = createAdminClient();
  const { data: existing } = await admin.from("staff_members").select("user_id").eq("email", parsed.data.email).maybeSingle();
  if (existing) return { error: "exists" };
  const password = tempPassword();
  const { data: created, error } = await admin.auth.admin.createUser({ email: parsed.data.email, password, email_confirm: true });
  let userId = created?.user?.id;
  const linked = Boolean(error || !userId);
  if (linked) {
    const { data: customer } = await admin.from("customers").select("auth_user_id").eq("email", parsed.data.email).not("auth_user_id", "is", null).maybeSingle();
    userId = customer?.auth_user_id ?? undefined;
    if (!userId) {
      const { data: users } = await admin.auth.admin.listUsers({ perPage: 1000 });
      userId = users?.users.find((user) => user.email?.toLowerCase() === parsed.data.email)?.id;
    }
    if (!userId) return { error: "failed" };
  }
  const { error: memberError } = await admin.from("staff_members").insert({ user_id: userId, email: parsed.data.email, display_name: parsed.data.displayName, job_title: parsed.data.jobTitle || null, active: true });
  if (memberError) return { error: "failed" };
  await admin.from("staff_roles").insert(parsed.data.roles.map((role) => ({ user_id: userId, role })));
  await audit({ actorUserId: session.userId, actorType: "STAFF", action: "staff.created", entityType: "staff", entityId: userId, metadata: { by: session.displayName, email: parsed.data.email, roles: parsed.data.roles, linked } });
  refresh();
  return linked ? { ok: true, email: parsed.data.email, linked: true } : { ok: true, password, email: parsed.data.email };
}

export async function setStaffRoles(_: StaffState, form: FormData): Promise<StaffState> {
  const session = await requirePermission("staff.manage");
  const parsed = targetInput.extend({ roles: z.array(z.enum(staffRoles)).min(1) }).safeParse({ userId: form.get("userId"), roles: rolesOf(form) });
  if (!parsed.success) return { error: "invalid" };
  if (parsed.data.userId === session.userId && !parsed.data.roles.includes("SUPER_ADMIN")) return { error: "self" };
  const admin = createAdminClient();
  const { data: current } = await admin.from("staff_roles").select("role").eq("user_id", parsed.data.userId);
  const existing = new Set((current ?? []).map((row) => row.role));
  const added = parsed.data.roles.filter((role) => !existing.has(role));
  const removed = [...existing].filter((role) => !parsed.data.roles.includes(role as StaffRole));
  if (added.length) {
    const { error } = await admin.from("staff_roles").insert(added.map((role) => ({ user_id: parsed.data.userId, role })));
    if (error) return { error: "failed" };
  }
  if (removed.length) {
    const { error } = await admin.from("staff_roles").delete().eq("user_id", parsed.data.userId).in("role", removed);
    if (error) return { error: "failed" };
  }
  await audit({ actorUserId: session.userId, actorType: "STAFF", action: "staff.role_changed", entityType: "staff", entityId: parsed.data.userId, metadata: { by: session.displayName, roles: parsed.data.roles } });
  refresh();
  return { ok: true };
}

export async function setStaffActive(form: FormData) {
  const session = await requirePermission("staff.manage");
  const parsed = targetInput.extend({ active: z.enum(["0", "1"]) }).safeParse({ userId: form.get("userId"), active: form.get("active") });
  if (!parsed.success || parsed.data.userId === session.userId) return;
  const active = parsed.data.active === "1";
  await createAdminClient().from("staff_members").update({ active }).eq("user_id", parsed.data.userId);
  await audit({ actorUserId: session.userId, actorType: "STAFF", action: active ? "staff.activated" : "staff.deactivated", entityType: "staff", entityId: parsed.data.userId, metadata: { by: session.displayName } });
  refresh();
}

export async function resetStaffPassword(_: StaffState, form: FormData): Promise<StaffState> {
  const session = await requirePermission("staff.manage");
  const parsed = targetInput.safeParse({ userId: form.get("userId") });
  if (!parsed.success) return { error: "invalid" };
  const admin = createAdminClient();
  const password = tempPassword();
  const { error } = await admin.auth.admin.updateUserById(parsed.data.userId, { password, email_confirm: true });
  if (error) return { error: "failed" };
  await audit({ actorUserId: session.userId, actorType: "STAFF", action: "staff.password_reset", entityType: "staff", entityId: parsed.data.userId, metadata: { by: session.displayName } });
  return { ok: true, password };
}

export async function resetStaffMfa(form: FormData) {
  const session = await requirePermission("staff.manage");
  const parsed = targetInput.safeParse({ userId: form.get("userId") });
  if (!parsed.success || parsed.data.userId === session.userId) return;
  const admin = createAdminClient();
  const { data } = await admin.auth.admin.mfa.listFactors({ userId: parsed.data.userId });
  for (const factor of data?.factors ?? []) await admin.auth.admin.mfa.deleteFactor({ id: factor.id, userId: parsed.data.userId });
  await audit({ actorUserId: session.userId, actorType: "STAFF", action: "staff.mfa_reset", entityType: "staff", entityId: parsed.data.userId, metadata: { by: session.displayName } });
  refresh();
}
