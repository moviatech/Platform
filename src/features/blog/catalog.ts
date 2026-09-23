const named: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

export function decodeEntities(text: string) {
  return text.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-z]+);/g, (match, name: string) => {
    if (name.startsWith("#x")) return String.fromCodePoint(parseInt(name.slice(2), 16));
    if (name.startsWith("#")) return String.fromCodePoint(Number(name.slice(1)));
    return named[name] ?? match;
  });
}

export function sitemapSlugs(xml: string) {
  const found = new Set<string>();
  for (const match of xml.matchAll(/<loc>[^<]*\/blog\/([a-z0-9-]{1,120})<\/loc>/g)) found.add(match[1]);
  return [...found];
}

const sections: Record<string, string> = {
  "FSD 指南": "fsd",
  "FSD Guides": "fsd",
  加州旅行: "travel",
  "California Travel": "travel",
  特斯拉租车入门: "tips",
  "Tesla Rental Tips": "tips",
  美国自驾指南: "driving",
  "Driving in California": "driving",
  租车指南: "rental",
  "Rental Advice": "rental",
  "Movia 动态": "news",
  "Movia News": "news",
};

export const categoryForSection = (section: string | null | undefined) => (section ? (sections[section.trim()] ?? null) : null);

export type ArticleMeta = { title: string | null; image: string | null; published: string | null; section: string | null };

function structuredArticle(html: string): Record<string, unknown> | null {
  for (const block of html.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const parsed: unknown = JSON.parse(block[1]);
      for (const item of Array.isArray(parsed) ? parsed : [parsed]) {
        if (item && typeof item === "object" && (item as Record<string, unknown>)["@type"] === "BlogPosting") return item as Record<string, unknown>;
      }
    } catch {}
  }
  return null;
}

export function articleMeta(html: string): ArticleMeta {
  const tag = (property: string) => {
    const meta = html.match(new RegExp(`<meta[^>]*property="${property}"[^>]*>`, "i"))?.[0];
    const content = meta?.match(/content="([^"]*)"/i)?.[1];
    return content ? decodeEntities(content).trim() || null : null;
  };
  const article = structuredArticle(html);
  const field = (name: string) => {
    const value = article?.[name];
    return typeof value === "string" && value.trim() ? value.trim() : null;
  };
  const image = field("image") ?? tag("og:image");
  const published = field("datePublished") ?? tag("article:published_time");
  return {
    title: field("headline") ?? tag("og:title"),
    image: image && /^https:\/\//.test(image) ? image : null,
    published: published && /^\d{4}-\d{2}-\d{2}/.test(published) ? published : null,
    section: field("articleSection") ?? tag("article:section"),
  };
}

export function matchesPost(post: { slug: string; title_zh: string; title_en: string }, term: string) {
  const query = term.trim().toLowerCase();
  if (!query) return true;
  return [post.slug, post.title_zh, post.title_en].some((value) => value.toLowerCase().includes(query));
}
