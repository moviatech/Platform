import { NextResponse } from "next/server";
import { markAllInvestorRead } from "@/features/notifications/center";
import { requireInvestor } from "@/lib/auth/investor";
import { investorOrigin } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";

export async function POST() {
  const session = await requireInvestor();
  await Promise.all([markAllInvestorRead(session.investorId), createAdminClient().from("conversations").update({ customer_unread: false, customer_read_at: new Date().toISOString() }).eq("investor_id", session.investorId).eq("customer_unread", true)]);
  return NextResponse.redirect(`${investorOrigin}/messages?status=notifications`, 303);
}
