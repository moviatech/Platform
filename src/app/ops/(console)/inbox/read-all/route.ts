import { NextResponse } from "next/server";
import { getStaffSession } from "@/lib/auth/staff";
import { opsOrigin } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";

export async function POST() {
  const session = await getStaffSession();
  if (session) await createAdminClient().from("conversations").update({ unread: false }).eq("unread", true);
  return NextResponse.redirect(`${opsOrigin}/inbox`, 303);
}
