import { NextResponse } from "next/server";
import { getPreviewPost } from "@/features/blog/public";
import { hasValidApiKey } from "@/lib/api-auth";

const headers = { "Cache-Control": "no-store" };

export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  if (!hasValidApiKey(request)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { token } = await params;
  try {
    const preview = await getPreviewPost(token);
    if (!preview) return NextResponse.json({ error: "not_found" }, { status: 404, headers });
    if ("issues" in preview) return NextResponse.json({ error: "incomplete", issues: preview.issues }, { status: 422, headers });
    return NextResponse.json(preview, { headers });
  } catch (cause) {
    console.error("[blog:preview]", cause instanceof Error ? cause.message : "failed");
    return NextResponse.json({ error: "query_failed" }, { status: 500, headers });
  }
}
