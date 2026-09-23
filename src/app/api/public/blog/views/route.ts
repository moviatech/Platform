import { NextResponse } from "next/server";
import { z } from "zod";
import { hasValidApiKey } from "@/lib/api-auth";
import { createAdminClient } from "@/lib/supabase/admin";

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((value) => value || null);

const input = z.object({
  slug: z.string().regex(/^[a-z0-9-]{1,120}$/),
  titleZh: optionalText(200),
  titleEn: optionalText(200),
  category: optionalText(40),
  publishedAt: z.iso.datetime({ offset: true }).optional(),
  coverUrl: z.url({ protocol: /^https$/ }).max(500).optional(),
});

export async function POST(request: Request) {
  if (!hasValidApiKey(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const parsed = input.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_fields" }, { status: 422 });
  }
  const view = parsed.data;

  let supabase: ReturnType<typeof createAdminClient>;
  try {
    supabase = createAdminClient();
  } catch {
    return NextResponse.json({ error: "not_configured" }, { status: 503 });
  }

  const { error } = await supabase.rpc("record_blog_view", {
    p_slug: view.slug,
    p_title_zh: view.titleZh,
    p_title_en: view.titleEn,
    p_category: view.category,
    p_published_at: view.publishedAt ?? null,
    p_cover_url: view.coverUrl ?? null,
  });
  if (error) {
    console.error("[blog:view]", error.message);
    return NextResponse.json({ error: "store_failed" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
