import { NextResponse } from "next/server";
import { markAllCustomerRead } from "@/features/notifications/center";
import { requireCustomer } from "@/lib/auth/customer";
import { portalOrigin } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";

export async function POST() {
  const session = await requireCustomer();
  await Promise.all([markAllCustomerRead(session.customerId), createAdminClient().from("conversations").update({ customer_unread: false, customer_read_at: new Date().toISOString() }).eq("customer_id", session.customerId).eq("customer_unread", true)]);
  return NextResponse.redirect(`${portalOrigin}/messages?status=notifications`, 303);
}
