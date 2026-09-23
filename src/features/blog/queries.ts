import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { listArticles } from "./articles";

export const maxFeatured = 5;

export type BlogState = "draft" | "scheduled" | "published" | "hidden";

export type BlogListRow = {
  slug: string;
  title_zh: string;
  title_en: string;
  category: string | null;
  kind: "site" | "cms";
  state: BlogState;
  dirty: boolean;
  published_at: string | null;
  sort_at: string;
  featured: boolean;
  views: number;
  last7: number;
};

function laDay(daysAgo: number) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(Date.now() - daysAgo * 86400000));
}

const stateOrder: Record<BlogState, number> = { draft: 0, scheduled: 1, published: 2, hidden: 2 };

export async function listBlogRows(): Promise<BlogListRow[]> {
  const supabase = createAdminClient();
  await supabase.rpc("blog_sync_catalog");
  const [articles, { data: posts, error }, { data: daily }] = await Promise.all([
    listArticles(),
    supabase.from("blog_posts").select("slug, title_zh, title_en, category, published_at, featured, hidden, views, source").limit(2000),
    supabase.from("blog_post_views").select("slug, count").gte("day", laDay(6)).limit(20000),
  ]);
  if (error) throw new Error(error.message);
  const now = Date.now();
  const recent = new Map<string, number>();
  for (const row of daily ?? []) recent.set(row.slug, (recent.get(row.slug) ?? 0) + row.count);
  const catalog = new Map((posts ?? []).map((post) => [post.slug as string, post]));
  const managed = new Set(articles.map((article) => article.slug));

  const fromArticles = articles.map<BlogListRow>((article) => {
    const post = catalog.get(article.slug);
    const live = article.status === "PUBLISHED";
    const state: BlogState = !live ? "draft" : article.publish_at && new Date(article.publish_at).getTime() > now ? "scheduled" : "published";
    return {
      slug: article.slug,
      title_zh: article.title_zh,
      title_en: article.title_en,
      category: article.category,
      kind: "cms",
      state,
      dirty: live && article.live_rev !== null && article.rev !== article.live_rev,
      published_at: live ? article.publish_at : null,
      sort_at: live && article.publish_at ? article.publish_at : article.updated_at,
      featured: state === "published" && Boolean(post?.featured) && !post?.hidden,
      views: Number(post?.views ?? 0),
      last7: recent.get(article.slug) ?? 0,
    };
  });

  const fromSite = (posts ?? [])
    .filter((post) => !managed.has(post.slug as string) && post.source !== "cms")
    .map<BlogListRow>((post) => ({
      slug: post.slug as string,
      title_zh: post.title_zh as string,
      title_en: post.title_en as string,
      category: post.category as string | null,
      kind: "site",
      state: post.hidden ? "hidden" : "published",
      dirty: false,
      published_at: post.published_at as string | null,
      sort_at: (post.published_at as string | null) ?? "",
      featured: Boolean(post.featured) && !post.hidden,
      views: Number(post.views),
      last7: recent.get(post.slug as string) ?? 0,
    }));

  return [...fromArticles, ...fromSite].sort((a, b) => stateOrder[a.state] - stateOrder[b.state] || b.sort_at.localeCompare(a.sort_at));
}
