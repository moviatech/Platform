import "server-only";
import { createClient } from "@/lib/supabase/server";

export const blogCategories = ["fsd", "travel", "tips", "driving", "rental", "news"] as const;

export const maxFeatured = 5;

export type BlogPostRow = {
  slug: string;
  title_zh: string;
  title_en: string;
  category: string | null;
  published_at: string | null;
  featured: boolean;
  hidden: boolean;
  views: number;
  last7: number;
};

export type BlogList = { posts: BlogPostRow[]; totals: { views: number; last7: number } };

function laDay(daysAgo: number) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" }).format(
    new Date(Date.now() - daysAgo * 86400000),
  );
}

export async function listBlogPosts(): Promise<BlogList> {
  const supabase = await createClient();
  const [{ data: posts, error }, { data: daily }] = await Promise.all([
    supabase
      .from("blog_posts")
      .select("slug, title_zh, title_en, category, published_at, featured, hidden, views")
      .order("published_at", { ascending: false, nullsFirst: false }),
    supabase.from("blog_post_views").select("slug, count").gte("day", laDay(6)),
  ]);
  if (error) throw new Error(error.message);
  const recent = new Map<string, number>();
  for (const row of daily ?? []) recent.set(row.slug, (recent.get(row.slug) ?? 0) + row.count);
  const rows: BlogPostRow[] = (posts ?? []).map((post) => ({ ...post, views: Number(post.views), last7: recent.get(post.slug) ?? 0 }));
  return {
    posts: rows,
    totals: {
      views: rows.reduce((sum, row) => sum + row.views, 0),
      last7: rows.reduce((sum, row) => sum + row.last7, 0),
    },
  };
}
