import "server-only";
import { websiteOrigin } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import { articleMeta, categoryForSection, sitemapSlugs } from "./catalog";

const pauseMs = 5 * 60000;
let checkedAt = 0;

async function fetchText(url: string) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(4000), cache: "no-store" });
    return response.ok ? await response.text() : null;
  } catch {
    return null;
  }
}

export async function syncBlogCatalog() {
  if (Date.now() - checkedAt < pauseMs) return 0;
  checkedAt = Date.now();
  const xml = await fetchText(`${websiteOrigin}/sitemap.xml`);
  const slugs = xml ? sitemapSlugs(xml) : [];
  if (!slugs.length) return 0;
  const supabase = createAdminClient();
  const { data: known } = await supabase.from("blog_posts").select("slug");
  const have = new Set((known ?? []).map((row) => row.slug));
  const missing = slugs.filter((slug) => !have.has(slug)).slice(0, 8);
  if (!missing.length) return 0;

  const rows = await Promise.all(
    missing.map(async (slug) => {
      const [zhPage, enPage] = await Promise.all([fetchText(`${websiteOrigin}/zh/blog/${slug}`), fetchText(`${websiteOrigin}/en/blog/${slug}`)]);
      const zh = zhPage ? articleMeta(zhPage) : null;
      const en = enPage ? articleMeta(enPage) : null;
      if (!zh?.title && !en?.title) return null;
      return {
        slug,
        title_zh: zh?.title ?? "",
        title_en: en?.title ?? "",
        category: categoryForSection(zh?.section) ?? categoryForSection(en?.section),
        published_at: zh?.published ?? en?.published ?? null,
        cover_url: zh?.image ?? en?.image ?? null,
      };
    }),
  );
  const found = rows.filter((row): row is NonNullable<typeof row> => Boolean(row));
  if (!found.length) return 0;
  const { error } = await supabase.from("blog_posts").upsert(found, { onConflict: "slug", ignoreDuplicates: true });
  return error ? 0 : found.length;
}
