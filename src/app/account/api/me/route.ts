import { NextResponse } from "next/server";
import { getCustomerSession } from "@/lib/auth/customer";
import { websiteOrigin } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";

export const meHeaders = {
  "Access-Control-Allow-Origin": websiteOrigin,
  "Access-Control-Allow-Credentials": "true",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  Vary: "Origin",
  "Cache-Control": "no-store",
};

function ageBandFor(dateOfBirth: string | null) {
  if (!dateOfBirth) return null;
  const birth = new Date(dateOfBirth);
  if (Number.isNaN(birth.getTime())) return null;
  const now = new Date();
  let age = now.getUTCFullYear() - birth.getUTCFullYear();
  if (now.getUTCMonth() < birth.getUTCMonth() || (now.getUTCMonth() === birth.getUTCMonth() && now.getUTCDate() < birth.getUTCDate())) age -= 1;
  return age >= 25 ? "25_PLUS" : "21_24";
}

export async function GET() {
  const session = await getCustomerSession();
  if (!session || !session.mfaVerified) return NextResponse.json({ customer: null }, { headers: meHeaders });
  const { data } = await createAdminClient().from("customers").select("stripe_payment_method_id, stripe_card_brand, stripe_card_last4").eq("id", session.customerId).maybeSingle();
  const customer = {
    fullName: session.fullName,
    email: session.email,
    phone: session.phone,
    wechat: session.wechat,
    language: session.language,
    card: data?.stripe_payment_method_id ? { brand: data.stripe_card_brand, last4: data.stripe_card_last4 } : null,
    ageBand: ageBandFor(session.dateOfBirth),
  };
  return NextResponse.json({ customer }, { headers: meHeaders });
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: meHeaders });
}
