import { NextResponse } from "next/server";
import { listPublicPosts } from "@/features/blog/public";
import { hasValidApiKey } from "@/lib/api-auth";

const headers = { "Cache-Control": "no-store" };

export async function GET(request: Request) {
  if (!hasValidApiKey(request)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    return NextResponse.json(await listPublicPosts(), { headers });
  } catch (cause) {
    console.error("[blog:posts]", cause instanceof Error ? cause.message : "failed");
    return NextResponse.json({ error: "query_failed" }, { status: 500, headers });
  }
}
