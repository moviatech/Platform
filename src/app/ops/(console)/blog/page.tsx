import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/Badge";
import { PageHeader } from "@/components/ops/PageHeader";
import { FeaturedToggle, VisibilityToggle } from "@/features/blog/BlogRowActions";
import { blogCategories, listBlogPosts, maxFeatured } from "@/features/blog/queries";
import { getStaffSession } from "@/lib/auth/staff";
import { cn } from "@/lib/utils/cn";
import { formatDateTime } from "@/lib/utils/format";

export const metadata: Metadata = { title: "Blog" };

const grid = "md:grid-cols-[minmax(0,1.8fr)_7rem_7.5rem_5rem_5rem_9rem_5.5rem_5rem]";

export default async function BlogPage() {
  await getStaffSession();
  const t = await getTranslations("blog");
  const common = await getTranslations("common");
  const locale = await getLocale();
  const { posts, totals } = await listBlogPosts();
  const featuredCount = posts.filter((post) => post.featured && !post.hidden).length;

  return (
    <>
      <PageHeader title={t("title")} />
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
                    <span className="text-right text-[13px] text-muted md:text-left">{post.published_at ? formatDateTime(post.published_at, locale) : "—"}</span>
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
