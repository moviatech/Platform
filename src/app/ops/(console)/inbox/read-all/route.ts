import { NextResponse } from "next/server";
import { getStaffSession } from "@/lib/auth/staff";
import { opsOrigin } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";

export async function POST() {
  const session = await getStaffSession();
  if (session) {
    let query = createAdminClient().from("conversations").update({ unread: false }).eq("unread", true);
    if (session.locationIds) query = query.in("location_id", session.locationIds);
    await query;
  }
  return NextResponse.redirect(`${opsOrigin}/inbox`, 303);
}
