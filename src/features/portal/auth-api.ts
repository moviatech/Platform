import "server-only";
import { NextResponse } from "next/server";
import { getCustomerSession } from "@/lib/auth/customer";
import { portalOrigin, websiteOrigin } from "@/lib/env";
export { clientIp, recentCount, record } from "@/lib/auth/throttle";

export const authHeaders = {
  "Access-Control-Allow-Origin": websiteOrigin,
  "Access-Control-Allow-Credentials": "true",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  Vary: "Origin",
  "Cache-Control": "no-store",
};

export function reply(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: authHeaders });
}

export function preflight() {
  return new NextResponse(null, { status: 204, headers: authHeaders });
}

export async function guard(request: Request): Promise<{ body: Record<string, unknown> } | { failed: NextResponse }> {
  const origin = request.headers.get("origin");
  const allowed = new Set([websiteOrigin, portalOrigin]);
  if (!origin || !allowed.has(origin)) return { failed: reply({ error: "forbidden" }, 403) };
  if (!/^application\/json\b/i.test(request.headers.get("content-type") ?? "")) return { failed: reply({ error: "forbidden" }, 403) };
  try {
    const body = await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) return { failed: reply({ error: "invalid" }, 422) };
    return { body: body as Record<string, unknown> };
  } catch {
    return { failed: reply({ error: "invalid" }, 422) };
  }
}

export async function customerPayload() {
  const session = await getCustomerSession();
  if (!session) return null;
  return { fullName: session.fullName, email: session.email, phone: session.phone, wechat: session.wechat, language: session.language };
}
