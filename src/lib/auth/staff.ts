import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { supabaseConfigured } from "@/lib/env";
import { hqOnlyPermissions, permissionsFor, type Permission, type StaffRole } from "./permissions";

export type StaffSession = {
  userId: string;
  email: string;
  displayName: string;
  roles: StaffRole[];
  permissions: Set<Permission>;
  locationIds: string[] | null;
};

export class ForbiddenError extends Error {
  constructor(permission: Permission | "scope") {
    super(`forbidden:${permission}`);
  }
}

export const getStaffSession = cache(async (): Promise<StaffSession> => {
  if (!supabaseConfigured) redirect("/setup");
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  const userId = auth?.claims.sub;
  if (!userId) redirect("/login");

  const [{ data: member }, { data: level }, { data: roleRows }, { data: locationRows }] = await Promise.all([
    supabase.from("staff_members").select("user_id, email, display_name, active").eq("user_id", userId).maybeSingle(),
    supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
    supabase.from("staff_roles").select("role").eq("user_id", userId),
    supabase.from("staff_locations").select("location_id").eq("user_id", userId),
  ]);
  if (!member || !member.active) redirect("/forbidden");
  if (level?.currentLevel !== "aal2") {
    redirect(level?.nextLevel === "aal2" ? "/mfa" : "/mfa/setup");
  }
  const roles = (roleRows ?? []).map((row) => row.role as StaffRole);
  const locationIds = locationRows?.length ? locationRows.map((row) => row.location_id as string) : null;
  const permissions = permissionsFor(roles);
  if (locationIds) for (const permission of hqOnlyPermissions) permissions.delete(permission);

  return {
    userId: member.user_id,
    email: member.email,
    displayName: member.display_name,
    roles,
    permissions,
    locationIds,
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

export async function requireHq(permission: Permission) {
  const session = await requirePermission(permission);
  if (session.locationIds !== null) throw new ForbiddenError("scope");
  return session;
}

export async function requireHqPage(permission: Permission) {
  const session = await requirePagePermission(permission);
  if (session.locationIds !== null) redirect("/forbidden");
  return session;
}
