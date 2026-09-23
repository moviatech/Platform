import { createAdminClient } from "@/lib/supabase/admin";
import { pick } from "./content";
import { guides } from "./guides";
import { siteLink } from "./site";

export type Recommendation = { key: string; title: string; summary: string; category: string | null; href: string; image: string; external: boolean };

type Stage = "booked" | "browsing";

const order: Record<Stage, string[]> = {
  booked: ["tips", "fsd", "rental", "driving", "travel", "news"],
  browsing: ["travel", "driving", "news", "tips", "fsd", "rental"],
};

const fallback: Record<Stage, string[]> = {
  booked: ["fsd-quick-start", "pickup", "charging", "return", "scenic-routes"],
  browsing: ["scenic-routes", "charging", "fsd-quick-start", "pickup", "return"],
};

export async function listRecommendations(stage: Stage, locale: string, limit: number, label: (category: string) => string): Promise<Recommendation[]> {
  const { data } = await createAdminClient()
    .from("blog_posts")
    .select("slug, title_zh, title_en, category, cover_url, featured, published_at")
    .eq("hidden", false)
    .order("featured", { ascending: false })
    .order("published_at", { ascending: false })
    .limit(24);
  const rank = (category: string | null) => {
    const index = order[stage].indexOf(category ?? "");
    return index === -1 ? 99 : index;
  };
  const posts = (data ?? [])
    .filter((post) => post.title_zh || post.title_en)
    .sort((a, b) => rank(a.category) - rank(b.category))
    .map<Recommendation>((post) => ({
      key: `post:${post.slug}`,
      title: locale === "zh" ? post.title_zh || post.title_en : post.title_en || post.title_zh,
      summary: post.category ? label(post.category) : "",
      category: post.category,
      href: siteLink(locale, `/blog/${post.slug}`),
      image: post.cover_url ?? "/portal/banners/banner-1-md.webp",
      external: true,
    }));
  const extra = fallback[stage]
    .map((slug) => guides.find((guide) => guide.slug === slug))
    .filter((guide): guide is NonNullable<typeof guide> => Boolean(guide))
    .map<Recommendation>((guide) => ({ key: `guide:${guide.slug}`, title: pick(guide.title, locale), summary: pick(guide.summary, locale), category: null, href: `/help/guides/${guide.slug}`, image: guide.image, external: false }));
  return [...posts, ...extra].slice(0, limit);
}
