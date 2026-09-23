import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { imageLookup } from "./articles";
import type { ArticleDraft, BlogCategory, ImageRef, LiveArticle, LiveLocale } from "./blocks";
import { draftSchema } from "./draft";
import { buildLive, laDate, type PublishIssue } from "./publish";

type Admin = ReturnType<typeof createAdminClient>;

type SummaryLocale = Omit<LiveLocale, "blocks">;

type Stored<Locale> = { category: BlogCategory; tags: string[]; cover: ImageRef; published: string; updated: string | null; zh: Locale; en: Locale };

type TagLabels = Record<string, { zh: string; en: string }>;

export type PublicPost<Locale> = { slug: string; category: BlogCategory; tags: string[]; published: string; updated: string | null; cover: ImageRef; content: { zh: Locale; en: Locale } };

export type PublicArticle = { post: PublicPost<LiveLocale>; tags: TagLabels };

export type PreviewPost = PublicArticle | { issues: PublishIssue[] } | null;

const testSlug = (slug: string) => slug.startsWith("zz-mkt-");

const testMode = () => process.env.MARKETING_BLOG_TEST === "1";

function shape<Locale>(slug: string, live: Stored<Locale>): PublicPost<Locale> {
  return { slug, category: live.category, tags: live.tags, published: live.published, updated: live.updated, cover: live.cover, content: { zh: live.zh, en: live.en } };
}

async function tagLabels(supabase: Admin, ids: string[]): Promise<TagLabels> {
  if (!ids.length) return {};
  const { data, error } = await supabase.from("blog_tags").select("id, label_zh, label_en").in("id", [...new Set(ids)].slice(0, 400));
  if (error) throw new Error(error.message);
  return Object.fromEntries((data ?? []).map((row) => [row.id as string, { zh: row.label_zh as string, en: row.label_en as string }]));
}

async function hiddenSlugs(supabase: Admin) {
  const { data, error } = await supabase.from("blog_posts").select("slug").eq("hidden", true).eq("source", "cms").limit(1000);
  if (error) throw new Error(error.message);
  return new Set((data ?? []).map((row) => row.slug as string));
}

export async function listPublicPosts(now = new Date()) {
  const supabase = createAdminClient();
  const { data, error } = await supabase.from("blog_articles").select("slug, live_summary, catalog_synced").eq("status", "PUBLISHED").lte("publish_at", now.toISOString()).order("publish_at", { ascending: false }).limit(500);
  if (error) throw new Error(error.message);
  const rows = data ?? [];
  if (rows.some((row) => !row.catalog_synced)) await supabase.rpc("blog_sync_catalog");
  const hidden = await hiddenSlugs(supabase);
  const posts = rows.filter((row) => row.live_summary && (testSlug(row.slug as string) ? testMode() : !hidden.has(row.slug as string))).map((row) => shape(row.slug as string, row.live_summary as Stored<SummaryLocale>));
  return { posts, tags: await tagLabels(supabase, posts.flatMap((post) => post.tags)) };
}

export async function getPublicPost(slug: string, now = new Date()): Promise<PublicArticle | null> {
  if (testSlug(slug) && !testMode()) return null;
  const supabase = createAdminClient();
  const { data: row, error } = await supabase.from("blog_articles").select("slug, live, catalog_synced").eq("slug", slug).eq("status", "PUBLISHED").lte("publish_at", now.toISOString()).maybeSingle();
  if (error) throw new Error(error.message);
  if (!row?.live) return null;
  if (!row.catalog_synced) await supabase.rpc("blog_sync_catalog");
  if (!testSlug(slug)) {
    const { data: post, error: failed } = await supabase.from("blog_posts").select("hidden").eq("slug", slug).maybeSingle();
    if (failed) throw new Error(failed.message);
    if (post?.hidden) return null;
  }
  const live = row.live as LiveArticle;
  return { post: shape(row.slug as string, live), tags: await tagLabels(supabase, live.tags) };
}

export async function getPreviewPost(token: string, now = new Date()): Promise<PreviewPost> {
  if (!/^[A-Za-z0-9_-]{32}$/.test(token)) return null;
  const supabase = createAdminClient();
  const { data: row, error } = await supabase.from("blog_articles").select("slug, draft, preview_expires_at").eq("preview_token", token).maybeSingle();
  if (error) throw new Error(error.message);
  if (!row?.preview_expires_at || new Date(row.preview_expires_at as string) <= now) return null;
  const parsed = draftSchema.safeParse(row.draft);
  if (!parsed.success) return null;
  const lookup = await imageLookup(row.slug as string);
  const draft: ArticleDraft = { ...parsed.data, cover: parsed.data.cover ? lookup(parsed.data.cover.src) : null };
  const { live, issues } = buildLive(draft, lookup, laDate(now));
  if (!live) return { issues: issues.filter((issue) => issue.level === "error") };
  return { post: shape(row.slug as string, live), tags: await tagLabels(supabase, live.tags) };
}
