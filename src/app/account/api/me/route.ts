import { NextResponse } from "next/server";
import { getCustomerSession } from "@/lib/auth/customer";
import { websiteOrigin } from "@/lib/env";

const headers = {
  "Access-Control-Allow-Origin": websiteOrigin,
  "Access-Control-Allow-Credentials": "true",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  Vary: "Origin",
  "Cache-Control": "no-store",
};

export async function GET() {
  const session = await getCustomerSession();
  const customer = session
    ? { fullName: session.fullName, email: session.email, phone: session.phone, wechat: session.wechat, language: session.language }
    : null;
  return NextResponse.json({ customer }, { headers });
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers });
}
