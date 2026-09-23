import { NextResponse } from "next/server";
import { ingestEmail } from "@/features/inbox/ingest";
import { hasValidInboundKey } from "@/lib/api-auth";

export const maxDuration = 60;

const maxRawBytes = 5 * 1024 * 1024;
const addressPattern = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

export async function POST(request: Request) {
  if (!hasValidInboundKey(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const to = request.headers.get("x-envelope-to")?.trim() ?? "";
  const from = request.headers.get("x-envelope-from")?.trim() ?? "";
  if (!addressPattern.test(to)) {
    return NextResponse.json({ error: "invalid_envelope" }, { status: 422 });
  }

  const raw = await request.arrayBuffer();
  if (raw.byteLength === 0 || raw.byteLength > maxRawBytes) {
    return NextResponse.json({ error: "invalid_size" }, { status: 413 });
  }

  try {
    const result = await ingestEmail(raw, { to, from });
    return NextResponse.json(result, { status: result.status === "stored" ? 201 : 200 });
  } catch (cause) {
    console.error("[inbound:email]", cause instanceof Error ? cause.message : cause);
    return NextResponse.json({ error: "ingest_failed" }, { status: 500 });
  }
}
