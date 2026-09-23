import { NextResponse } from "next/server";
import { slugPattern } from "@/features/blog/blocks";
import { getPublicPost } from "@/features/blog/public";
import { hasValidApiKey } from "@/lib/api-auth";

const headers = { "Cache-Control": "no-store" };

export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  if (!hasValidApiKey(request)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { slug } = await params;
  if (!slugPattern.test(slug) || slug.length > 120) return NextResponse.json({ error: "not_found" }, { status: 404, headers });
  try {
    const found = await getPublicPost(slug);
    return found ? NextResponse.json(found, { headers }) : NextResponse.json({ error: "not_found" }, { status: 404, headers });
  } catch (cause) {
    console.error("[blog:post]", cause instanceof Error ? cause.message : "failed");
    return NextResponse.json({ error: "query_failed" }, { status: 500, headers });
  }
}
