import { NextResponse } from "next/server";
import { recordHandoff } from "@/features/portal/handoff";
import { getCustomerSession, type CustomerSession } from "@/lib/auth/customer";
import { websiteOrigin } from "@/lib/env";

async function forward(request: Request, init: RequestInit, onBody?: (session: CustomerSession, body: string) => Promise<string>) {
  const session = await getCustomerSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const url = new URL(request.url);
  const ip = request.headers.get("cf-connecting-ip") ?? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "portal";
  try {
    const response = await fetch(`${websiteOrigin}/api/assistant${url.search}`, {
      ...init,
      headers: { "content-type": "application/json", "x-forwarded-for": ip, referer: `${url.origin}/help` },
      cache: "no-store",
    });
    let body = await response.text();
    if (response.ok && onBody) body = await onBody(session, body);
    return new NextResponse(body, { status: response.status, headers: { "content-type": "application/json" } });
  } catch {
    return NextResponse.json({ error: "unavailable" }, { status: 502 });
  }
}

export async function GET(request: Request) {
  return forward(request, { method: "GET" });
}

export async function POST(request: Request) {
  const raw = await request.text();
  let locale = "en";
  try {
    const parsed = JSON.parse(raw) as { locale?: unknown };
    if (parsed.locale === "zh") locale = "zh";
  } catch {}
  return forward(request, { method: "POST", body: raw }, async (session, body) => {
    let snapshot: { id?: string; escalated?: unknown; messages?: Array<{ role?: string; text?: string }> };
    try {
      snapshot = JSON.parse(body);
    } catch {
      return body;
    }
    if (!snapshot.escalated) return body;
    const conversationId = await recordHandoff(session, snapshot, locale).catch(() => null);
    return conversationId ? JSON.stringify({ ...snapshot, handoffConversationId: conversationId }) : body;
  });
}
