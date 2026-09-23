import { NextResponse } from "next/server";
import { markAllStaffRead } from "@/features/notifications/center";
import { can, getStaffSession } from "@/lib/auth/staff";
import { opsOrigin } from "@/lib/env";

export async function POST() {
  const session = await getStaffSession();
  if (can(session, "inbox.view")) await markAllStaffRead(session.locationIds);
  return NextResponse.redirect(`${opsOrigin}/inbox?view=notifications`, 303);
}
