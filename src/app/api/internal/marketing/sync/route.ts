import { NextResponse } from "next/server";
import { runGoogleSync } from "@/features/marketing/sync";
import { hasValidInternalKey } from "@/lib/api-auth";

export const maxDuration = 30;

export async function POST(request: Request) {
  if (!hasValidInternalKey(request)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    return NextResponse.json({ ok: true, ...(await runGoogleSync()) }, { headers: { "Cache-Control": "no-store" } });
  } catch (cause) {
    console.error("[marketing:sync]", cause instanceof Error ? cause.message : "failed");
    return NextResponse.json({ error: "failed" }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
