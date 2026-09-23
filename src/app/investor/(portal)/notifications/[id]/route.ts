import { NextResponse } from "next/server";
import { markInvestorNotificationRead } from "@/features/notifications/center";
import { requireInvestor } from "@/lib/auth/investor";
import { investorOrigin } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  const session = await requireInvestor();
  const { id } = await context.params;
  if (!uuid.test(id)) return NextResponse.redirect(`${investorOrigin}/messages`);
  const { data } = await createAdminClient().from("notifications").select("href").eq("id", id).eq("audience", "INVESTOR").eq("investor_id", session.investorId).maybeSingle();
  await markInvestorNotificationRead(id, session.investorId);
  const href = data?.href && data.href.startsWith("/") && !data.href.startsWith("//") ? data.href : "/messages?status=notifications";
  return NextResponse.redirect(`${investorOrigin}${href}`);
}
