import { NextResponse } from "next/server";
import { hasValidApiKey } from "@/lib/api-auth";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET(request: Request) {
  if (!hasValidApiKey(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let supabase: ReturnType<typeof createAdminClient>;
  try {
    supabase = createAdminClient();
  } catch {
    return NextResponse.json({ error: "not_configured" }, { status: 503 });
  }

  const { data, error } = await supabase.from("blog_posts").select("slug, featured, hidden, featured_at, published_at").or("featured.eq.true,hidden.eq.true");
  if (error) {
    console.error("[blog:meta]", error.message);
    return NextResponse.json({ error: "query_failed" }, { status: 500 });
  }

  const rows = data ?? [];
  const stamp = (value: string | null) => (value ? new Date(value).getTime() : 0);
  const featured = rows
    .filter((row) => row.featured && !row.hidden)
    .sort((a, b) => stamp(b.featured_at) - stamp(a.featured_at) || stamp(b.published_at) - stamp(a.published_at))
    .map((row) => row.slug);
  return NextResponse.json(
    {
      featured,
      hidden: rows.filter((row) => row.hidden).map((row) => row.slug),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
