import { NextResponse } from "next/server";
import { z } from "zod";
import { normalizeComment, normalizeScore, saveRating, lastStaffResponder } from "@/features/ratings/service";
import { createAdminClient } from "@/lib/supabase/admin";

const origins = new Set(["https://www.moviatech.ai", "https://moviatech.ai", "http://localhost:3200", "http://localhost:3100"]);
const tokenPattern = /^[a-f0-9]{20}$/;

function headersFor(request: Request) {
  const origin = request.headers.get("origin") ?? "";
  return {
    "Access-Control-Allow-Origin": origins.has(origin) ? origin : "https://www.moviatech.ai",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
    "Cache-Control": "no-store",
  };
}

const input = z.object({ score: z.number().int().min(1).max(5), comment: z.string().max(500).optional() });

export async function OPTIONS(request: Request) {
  return new NextResponse(null, { status: 204, headers: headersFor(request) });
}

export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const headers = headersFor(request);
  const { token } = await params;
  if (!tokenPattern.test(token)) return NextResponse.json({ error: "not_found" }, { status: 404, headers });
  const parsed = input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_fields" }, { status: 422, headers });
  const { data: conversation } = await createAdminClient().from("conversations").select("id, status, ended_at, customer_id").eq("token", token).maybeSingle();
  if (!conversation) return NextResponse.json({ error: "not_found" }, { status: 404, headers });
  if (conversation.status !== "RESOLVED" && !conversation.ended_at) return NextResponse.json({ error: "not_ended" }, { status: 409, headers });
  const score = normalizeScore(parsed.data.score);
  if (!score) return NextResponse.json({ error: "invalid_fields" }, { status: 422, headers });
  const responder = await lastStaffResponder(conversation.id);
  await saveRating({ kind: "CONVERSATION", score, comment: normalizeComment(parsed.data.comment, score), customerId: conversation.customer_id, conversationId: conversation.id, staffUserId: responder?.userId ?? null, source: "PORTAL" });
  return NextResponse.json({ ok: true }, { headers });
}
