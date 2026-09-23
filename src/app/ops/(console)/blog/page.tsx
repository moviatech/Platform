import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/Badge";
import { PageHeader } from "@/components/ops/PageHeader";
import { QueryFilters } from "@/components/ops/QueryFilters";
import { FeaturedToggle, VisibilityToggle } from "@/features/blog/BlogRowActions";
import { matchesPost } from "@/features/blog/catalog";
import { blogCategories, listBlogPosts, maxFeatured } from "@/features/blog/queries";
import { syncBlogCatalog } from "@/features/blog/sync";
import { requirePagePermission } from "@/lib/auth/staff";
import { cn } from "@/lib/utils/cn";
import { formatDateTime } from "@/lib/utils/format";

export const metadata: Metadata = { title: "Blog" };

const grid = "md:grid-cols-[minmax(0,1.8fr)_7rem_7.5rem_5rem_5rem_9rem_5.5rem_5rem]";

type Props = { searchParams: Promise<{ q?: string; category?: string; status?: string }> };

export default async function BlogPage({ searchParams }: Props) {
  await requirePagePermission("blog.manage");
  const filters = await searchParams;
  await syncBlogCatalog().catch(() => 0);
  const t = await getTranslations("blog");
  const common = await getTranslations("common");
  const locale = await getLocale();
  const all = (await listBlogPosts()).posts;
  const featuredCount = all.filter((post) => post.featured && !post.hidden).length;
  const posts = all.filter((post) => {
    if (!matchesPost(post, filters.q ?? "")) return false;
    if (filters.category && post.category !== filters.category) return false;
    if (filters.status === "published" && post.hidden) return false;
    if (filters.status === "hidden" && !post.hidden) return false;
    if (filters.status === "featured" && !(post.featured && !post.hidden)) return false;
    return true;
  });
  const totals = { views: posts.reduce((sum, post) => sum + post.views, 0), last7: posts.reduce((sum, post) => sum + post.last7, 0) };

  return (
    <>
      <PageHeader title={t("title")} />
      <QueryFilters
        search={{ name: "q", placeholder: t("filters.search") }}
        selects={[
          { name: "category", label: t("columns.category"), options: blogCategories.map((key) => ({ value: key, label: t(`category.${key}`) })) },
          { name: "status", label: t("columns.status"), options: [{ value: "published", label: t("published") }, { value: "hidden", label: t("hidden") }, { value: "featured", label: t("columns.featured") }] },
        ]}
      />
      {posts.length === 0 ? (
        <div className="card px-6 py-14 text-center text-sm text-muted">{common("empty")}</div>
      ) : (
        <div className="card overflow-hidden">
          <div className={`hidden gap-4 border-b border-ink/[0.07] bg-pearl/60 px-5 py-2.5 text-[11px] font-medium tracking-[0.12em] text-muted uppercase md:grid ${grid}`}>
            <span>{t("columns.title")}</span>
            <span>{t("columns.category")}</span>
            <span>{t("columns.published")}</span>
            <span className="text-right">{t("columns.views")}</span>
            <span className="text-right">{t("columns.last7")}</span>
            <span>
              {t("columns.featured")} {featuredCount}/{maxFeatured}
            </span>
            <span>{t("columns.status")}</span>
            <span className="text-right">{t("columns.actions")}</span>
          </div>
          <ul className="divide-y divide-ink/[0.06]">
            {posts.map((post) => {
              const category = (blogCategories as readonly string[]).includes(post.category ?? "") ? t(`category.${post.category}`) : (post.category ?? "—");
              return (
                <li key={post.slug} className={cn(post.hidden && "opacity-50")}>
                  <div className={`grid grid-cols-2 gap-x-4 gap-y-1.5 px-5 py-3.5 text-sm md:items-center ${grid}`}>
                    <a
                      href={`https://www.moviatech.ai/${locale}/blog/${post.slug}`}
                      target="_blank"
                      rel="noreferrer"
                      className="col-span-2 truncate font-medium hover:text-gold md:col-span-1"
                    >
                      {(locale === "zh" ? post.title_zh : post.title_en) || post.title_en || post.title_zh || post.slug}
                    </a>
                    <span className="text-[13px] text-charcoal">{category}</span>
                    <span className="text-right text-[13px] text-muted md:text-left">{post.published_at ? formatDateTime(post.published_at) : "—"}</span>
                    <span className="text-[13px] tabular-nums text-charcoal md:text-right">{post.views.toLocaleString("en-US")}</span>
                    <span className="text-right text-[13px] tabular-nums text-charcoal">{post.last7.toLocaleString("en-US")}</span>
                    <span>
                      <FeaturedToggle slug={post.slug} featured={post.featured} hidden={post.hidden} canFeature={featuredCount < maxFeatured} />
                    </span>
                    <span className="text-right md:text-left">
                      <Badge tone={post.hidden ? "neutral" : "success"}>{post.hidden ? t("hidden") : t("published")}</Badge>
                    </span>
                    <span className="col-span-2 text-right md:col-span-1">
                      <VisibilityToggle slug={post.slug} hidden={post.hidden} />
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
          <div className={`hidden gap-4 border-t border-ink/[0.07] bg-pearl/40 px-5 py-2.5 text-[13px] md:grid ${grid}`}>
            <span className="font-medium">{t("total")}</span>
            <span />
            <span />
            <span className="text-right tabular-nums">{totals.views.toLocaleString("en-US")}</span>
            <span className="text-right tabular-nums">{totals.last7.toLocaleString("en-US")}</span>
          </div>
        </div>
      )}
    </>
  );
}
