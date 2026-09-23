import { NextResponse } from "next/server";
import { markAllStaffRead } from "@/features/notifications/center";
import { getStaffSession } from "@/lib/auth/staff";
import { opsOrigin } from "@/lib/env";

export async function POST() {
  const session = await getStaffSession();
  if (session) await markAllStaffRead();
  return NextResponse.redirect(`${opsOrigin}/inbox?view=notifications`, 303);
}
