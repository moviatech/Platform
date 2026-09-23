import { NextResponse } from "next/server";
import { markNotificationRead } from "@/features/notifications/center";
import { getStaffSession } from "@/lib/auth/staff";
import { opsOrigin } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  const session = await getStaffSession();
  const { id } = await context.params;
  if (!session || !/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.redirect(`${opsOrigin}/inbox?view=notifications`);
  const { data } = await createAdminClient().from("notifications").select("href").eq("id", id).eq("audience", "STAFF").maybeSingle();
  await markNotificationRead(id, "STAFF");
  return NextResponse.redirect(`${opsOrigin}${data?.href ?? "/inbox?view=notifications"}`);
}
