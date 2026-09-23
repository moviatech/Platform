import "server-only";
import { rootDomain } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import { googleFailure, inspectUrl } from "./google/client";
import { googleSettings } from "./google/config";

export type UrlCheck = { verdict: string | null; coverage: string | null; lastCrawl: string | null; checkedAt: string; error: string | null };

export type ArticleIndex = { slug: string; titleZh: string; titleEn: string; zh: UrlCheck | null; en: UrlCheck | null };

const siteOrigin = `https://www.${rootDomain}`;

export const articleUrls = (slug: string) => ({ zh: `${siteOrigin}/zh/blog/${slug}`, en: `${siteOrigin}/en/blog/${slug}` });

async function publishedArticles() {
  const { data, error } = await createAdminClient().from("blog_articles").select("slug, title_zh, title_en, publish_at").eq("status", "PUBLISHED").lte("publish_at", new Date().toISOString()).not("slug", "like", "zz-mkt-%").order("publish_at", { ascending: false }).limit(500);
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => ({ slug: row.slug as string, titleZh: row.title_zh as string, titleEn: row.title_en as string }));
}

export async function loadIndexStatus(): Promise<ArticleIndex[]> {
  const { site } = googleSettings();
  const articles = await publishedArticles();
  if (!site || !articles.length) return articles.map((article) => ({ ...article, zh: null, en: null }));
  const { data, error } = await createAdminClient().from("marketing_url_checks").select("url, verdict, coverage, last_crawl, checked_at, error").eq("site", site).limit(2000);
  if (error) throw new Error(error.message);
  const checks = new Map((data ?? []).map((row) => [row.url as string, { verdict: row.verdict as string | null, coverage: row.coverage as string | null, lastCrawl: row.last_crawl as string | null, checkedAt: row.checked_at as string, error: row.error as string | null }]));
  return articles.map((article) => {
    const urls = articleUrls(article.slug);
    return { ...article, zh: checks.get(urls.zh) ?? null, en: checks.get(urls.en) ?? null };
  });
}

export async function checkUrls(urls: string[], timeoutMs = 15000) {
  const { site } = googleSettings();
  if (!site) return 0;
  const supabase = createAdminClient();
  const results = await Promise.all(
    urls.map(async (url) => {
      const checkedAt = new Date().toISOString();
      try {
        const result = await inspectUrl(url, timeoutMs);
        await supabase.from("marketing_url_checks").upsert({ site, url, verdict: result.verdict || null, coverage: result.coverage || null, indexing: result.indexing || null, fetch_state: result.fetchState || null, robots: result.robots || null, canonical: result.canonical || null, last_crawl: result.lastCrawl, error: null, checked_at: checkedAt });
        return true;
      } catch (cause) {
        await supabase.from("marketing_url_checks").upsert({ site, url, error: googleFailure(cause).slice(0, 300), checked_at: checkedAt });
        return false;
      }
    }),
  );
  return results.filter(Boolean).length;
}

export async function checkArticle(slug: string) {
  const urls = articleUrls(slug);
  return checkUrls([urls.zh, urls.en]);
}

export async function checkOldest(limit: number, olderThanHours = 72, timeoutMs = 15000) {
  const { site } = googleSettings();
  if (!site) return 0;
  const articles = await publishedArticles();
  const { data } = await createAdminClient().from("marketing_url_checks").select("url, checked_at, error").eq("site", site).limit(2000);
  const seen = new Map((data ?? []).map((row) => [row.url as string, row.error ? 0 : new Date(row.checked_at as string).getTime()]));
  const cutoff = Date.now() - olderThanHours * 3600000;
  const due = articles
    .flatMap((article) => Object.values(articleUrls(article.slug)))
    .map((url) => ({ url, at: seen.get(url) ?? 0 }))
    .filter((item) => item.at < cutoff)
    .sort((a, b) => a.at - b.at)
    .slice(0, limit)
    .map((item) => item.url);
  return due.length ? checkUrls(due, timeoutMs) : 0;
}
