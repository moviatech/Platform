import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { StaffRole } from "@/lib/auth/permissions";

export type StaffRow = { user_id: string; email: string; display_name: string; job_title: string | null; active: boolean; last_login_at: string | null; created_at: string; roles: StaffRole[] };

export async function listStaff(): Promise<StaffRow[]> {
  const supabase = await createClient();
  const [{ data: members }, { data: roles }] = await Promise.all([
    supabase.from("staff_members").select("user_id, email, display_name, job_title, active, last_login_at, created_at").order("created_at"),
    supabase.from("staff_roles").select("user_id, role"),
  ]);
  return (members ?? []).map((member) => ({
    ...member,
    roles: (roles ?? []).filter((row) => row.user_id === member.user_id).map((row) => row.role as StaffRole),
  })) as StaffRow[];
}
