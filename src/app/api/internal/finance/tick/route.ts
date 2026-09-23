import { NextResponse } from "next/server";
import { runFinanceTick } from "@/features/finance/ledger/job";
import { hasValidInternalKey } from "@/lib/api-auth";

export const maxDuration = 60;

const headers = { "Cache-Control": "no-store" };

export async function POST(request: Request) {
  if (!hasValidInternalKey(request)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    const result = await runFinanceTick(request.headers.get("x-forwarded-host") ?? request.headers.get("host"));
    return NextResponse.json(result, { status: result.skipped || result.ok ? 200 : 500, headers });
  } catch (cause) {
    const error = cause instanceof Error ? cause.message : "failed";
    console.error("[finance:tick]", error);
    return NextResponse.json({ skipped: false, ok: false, error }, { status: 500, headers });
  }
}
