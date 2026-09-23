import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ArticleDraft, ImageRef, LiveArticle } from "./blocks";
import { toImageRef, type MediaItem } from "./media";

export type ArticleStatus = "DRAFT" | "PUBLISHED";

export type ArticleRow = {
  slug: string;
  status: ArticleStatus;
  category: string;
  draft: ArticleDraft;
  live: LiveArticle | null;
  publish_at: string | null;
  rev: number;
  live_rev: number | null;
  updated_at: string;
};

export type ArticleSummary = Pick<ArticleRow, "slug" | "status" | "category" | "publish_at" | "rev" | "live_rev" | "updated_at"> & { title_zh: string; title_en: string };

export type TagRow = { id: string; label_zh: string; label_en: string };

export type RevisionSummary = { id: string; kind: string; created_by_name: string | null; created_at: string };

export const revisionLimit = 30;

export async function listArticles(): Promise<ArticleSummary[]> {
  const { data, error } = await createAdminClient().from("blog_articles").select("slug, status, category, title_zh, title_en, publish_at, rev, live_rev, updated_at").order("updated_at", { ascending: false }).limit(1000);
  if (error) throw new Error(error.message);
  return (data ?? []) as ArticleSummary[];
}

export async function getArticle(slug: string): Promise<ArticleRow | null> {
  const { data, error } = await createAdminClient().from("blog_articles").select("slug, status, category, draft, live, publish_at, rev, live_rev, updated_at").eq("slug", slug).maybeSingle();
  if (error) throw new Error(error.message);
  return (data as ArticleRow | null) ?? null;
}

export async function listMedia(slug: string): Promise<MediaItem[]> {
  const { data } = await createAdminClient().from("blog_media").select("id, src, width, height, blur, name, bytes").eq("slug", slug).order("created_at", { ascending: false }).limit(200);
  return (data ?? []) as MediaItem[];
}

export async function listTags(): Promise<TagRow[]> {
  const { data } = await createAdminClient().from("blog_tags").select("id, label_zh, label_en").order("id").limit(500);
  return (data ?? []) as TagRow[];
}

export async function listRevisions(slug: string): Promise<RevisionSummary[]> {
  const { data } = await createAdminClient().from("blog_article_revisions").select("id, kind, created_by_name, created_at").eq("slug", slug).order("created_at", { ascending: false }).limit(revisionLimit);
  return (data ?? []) as RevisionSummary[];
}

export async function imageLookup(slug: string): Promise<(src: string) => ImageRef | null> {
  const { data, error } = await createAdminClient().from("blog_media").select("src, width, height, blur").eq("slug", slug).limit(500);
  if (error) throw new Error(error.message);
  const known = new Map((data ?? []).map((row) => [row.src as string, toImageRef(row as Pick<MediaItem, "src" | "width" | "height" | "blur">)]));
  return (src) => known.get(src) ?? null;
}
