import { NextResponse } from "next/server";
import { markNotificationRead } from "@/features/notifications/center";
import { getCustomerSession } from "@/lib/auth/customer";
import { portalOrigin } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  const session = await getCustomerSession();
  const { id } = await context.params;
  if (!session || !/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.redirect(`${portalOrigin}/messages?status=notifications`);
  const { data } = await createAdminClient().from("notifications").select("href").eq("id", id).eq("customer_id", session.customerId).maybeSingle();
  await markNotificationRead(id, "CUSTOMER", session.customerId);
  return NextResponse.redirect(`${portalOrigin}${data?.href ?? "/messages?status=notifications"}`);
}
