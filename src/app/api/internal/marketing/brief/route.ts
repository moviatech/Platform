import { NextResponse } from "next/server";
import { runBrief } from "@/features/marketing/brief";
import { hasValidInternalKey } from "@/lib/api-auth";

export const maxDuration = 30;

export async function POST(request: Request) {
  if (!hasValidInternalKey(request)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const force = new URL(request.url).searchParams.get("force") === "1";
  try {
    const result = await runBrief({ force });
    return NextResponse.json({ ok: ["created", "exists", "no_data"].includes(result.status), ...result }, { headers: { "Cache-Control": "no-store" } });
  } catch (cause) {
    console.error("[marketing:brief]", cause instanceof Error ? cause.message : "failed");
    return NextResponse.json({ error: "failed" }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
