import { NextResponse } from "next/server";
import { markAllCustomerRead } from "@/features/notifications/center";
import { requireCustomer } from "@/lib/auth/customer";
import { portalOrigin } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";

const views = ["open", "resolved", "notifications"];

export async function POST(request: Request) {
  const session = await requireCustomer();
  const form = await request.formData().catch(() => null);
  const status = String(form?.get("status") ?? "");
  const conversation = String(form?.get("conversation") ?? "");
  const target = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(conversation) ? `/messages/${conversation}` : views.includes(status) ? `/messages?status=${status}` : "/messages";
  await Promise.all([markAllCustomerRead(session.customerId), createAdminClient().from("conversations").update({ customer_unread: false, customer_read_at: new Date().toISOString() }).eq("customer_id", session.customerId).eq("customer_unread", true)]);
  return NextResponse.redirect(`${portalOrigin}${target}`, 303);
}
