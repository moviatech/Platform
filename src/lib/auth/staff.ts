import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { supabaseConfigured } from "@/lib/env";
import { permissionsFor, type Permission, type StaffRole } from "./permissions";

export type StaffSession = {
  userId: string;
  email: string;
  displayName: string;
  roles: StaffRole[];
  permissions: Set<Permission>;
};

export class ForbiddenError extends Error {
  constructor(permission: Permission) {
    super(`forbidden:${permission}`);
  }
}

export const getStaffSession = cache(async (): Promise<StaffSession> => {
  if (!supabaseConfigured) redirect("/setup");
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) redirect("/login");

  const [{ data: member }, { data: level }, { data: roleRows }] = await Promise.all([
    supabase.from("staff_members").select("user_id, email, display_name, active").eq("user_id", auth.user.id).maybeSingle(),
    supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
    supabase.from("staff_roles").select("role").eq("user_id", auth.user.id),
  ]);
  if (!member || !member.active) redirect("/forbidden");
  if (level?.currentLevel !== "aal2") {
    redirect(level?.nextLevel === "aal2" ? "/mfa" : "/mfa/setup");
  }
  const roles = (roleRows ?? []).map((row) => row.role as StaffRole);

  return {
    userId: member.user_id,
    email: member.email,
    displayName: member.display_name,
    roles,
    permissions: permissionsFor(roles),
  };
});

export function can(session: StaffSession, permission: Permission) {
  return session.permissions.has(permission);
}

export async function requirePermission(permission: Permission) {
  const session = await getStaffSession();
  if (!can(session, permission)) throw new ForbiddenError(permission);
  return session;
}

export async function requirePagePermission(permission: Permission) {
  const session = await getStaffSession();
  if (!can(session, permission)) redirect("/forbidden");
  return session;
}
