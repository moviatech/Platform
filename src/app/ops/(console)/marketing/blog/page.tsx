import type { Metadata } from "next";
import Link from "next/link";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { ButtonLink } from "@/components/ui/Button";
import { PageHeader } from "@/components/ops/PageHeader";
import { QueryFilters } from "@/components/ops/QueryFilters";
import { blogCategories } from "@/features/blog/blocks";
import { FeaturedToggle, VisibilityToggle } from "@/features/blog/BlogRowActions";
import { matchesPost } from "@/features/blog/catalog";
import { ListDrop } from "@/features/blog/DropVeil";
import { listBlogRows, maxFeatured, type BlogState } from "@/features/blog/queries";
import { syncBlogCatalog } from "@/features/blog/sync";
import { googleStatus } from "@/features/marketing/google/config";
import { marketingMessages } from "@/features/marketing/i18n";
import { loadBlogSearch } from "@/features/marketing/search";
import { loadBlogLanding } from "@/features/marketing/traffic";
import { can, requirePagePermission } from "@/lib/auth/staff";
import { websiteOrigin } from "@/lib/env";
import { cn } from "@/lib/utils/cn";
import { formatDateTime } from "@/lib/utils/format";

export const metadata: Metadata = { title: "Blog" };

const grid = "md:grid-cols-[minmax(0,1.8fr)_7rem_7.5rem_5rem_5rem_9rem_9rem_5rem]";

const tones: Record<BlogState, BadgeTone> = { draft: "neutral", scheduled: "info", published: "success", hidden: "neutral" };

type Props = { searchParams: Promise<{ q?: string; category?: string; status?: string }> };

export default async function BlogPage({ searchParams }: Props) {
  const session = await requirePagePermission("blog.manage");
  const filters = await searchParams;
  await syncBlogCatalog().catch(() => 0);
  const connected = googleStatus();
  const insight = can(session, "marketing.view");
  const [{ locale, messages }, all, found, landed] = await Promise.all([
    marketingMessages(),
    listBlogRows(),
    insight && connected.search ? loadBlogSearch().then((result) => result.value).catch(() => null) : null,
    insight && connected.analytics ? loadBlogLanding().then((result) => result.value).catch(() => null) : null,
  ]);
  const t = messages.blog;
  const categoryLabels: Record<string, string> = t.category;
  const featuredCount = all.filter((row) => row.featured).length;
  const rows = all.filter((row) => {
    if (!matchesPost(row, filters.q ?? "")) return false;
    if (filters.category && row.category !== filters.category) return false;
    if (filters.status === "featured") return row.featured;
    if (filters.status && row.state !== filters.status) return false;
    return true;
  });
  const totals = { views: rows.reduce((sum, row) => sum + row.views, 0), last7: rows.reduce((sum, row) => sum + row.last7, 0) };

  return (
    <>
      <PageHeader
        title={t.title}
        actions={
          <ButtonLink href="/marketing/blog/new" size="sm">
            {t.new}
          </ButtonLink>
        }
      />
      <ListDrop label={t.create.drop} />
      <QueryFilters
        search={{ name: "q", placeholder: t.filters.search }}
        selects={[
          { name: "category", label: t.columns.category, options: blogCategories.map((key) => ({ value: key, label: t.category[key] })) },
          { name: "status", label: t.columns.status, options: [...(["draft", "scheduled", "published", "hidden"] as const).map((key) => ({ value: key, label: t.state[key] })), { value: "featured", label: t.filters.featured }] },
        ]}
      />
      {rows.length === 0 ? (
        <div className="card px-6 py-14 text-center text-sm text-muted">{t.empty}</div>
      ) : (
        <div className="card overflow-hidden">
          <div className={`hidden gap-4 border-b border-ink/[0.07] bg-pearl/60 px-5 py-2.5 text-[11px] font-medium tracking-[0.12em] text-muted uppercase md:grid ${grid}`}>
            <span>{t.columns.title}</span>
            <span>{t.columns.category}</span>
            <span>{t.columns.published}</span>
            <span className="text-right">{t.columns.views}</span>
            <span className="text-right">{t.columns.last7}</span>
            <span>
              {t.columns.featured} {featuredCount}/{maxFeatured}
            </span>
            <span>{t.columns.status}</span>
            <span className="text-right">{t.columns.actions}</span>
          </div>
          <ul className="divide-y divide-ink/[0.06]">
            {rows.map((row) => {
              const title = (locale === "zh" ? row.title_zh : row.title_en) || row.title_en || row.title_zh || row.slug;
              const titleClass = "block truncate font-medium hover:text-gold";
              const searched = row.kind === "cms" ? found?.[row.slug] : undefined;
              const bookings = row.kind === "cms" ? landed?.[row.slug]?.keyEvents : undefined;
              return (
                <li key={row.slug} className={cn(row.state === "hidden" && "opacity-50")}>
                  <div className={`grid grid-cols-2 gap-x-4 gap-y-1.5 px-5 py-3.5 text-sm md:items-center ${grid}`}>
                    <div className="col-span-2 min-w-0 md:col-span-1">
                      {row.kind === "cms" ? (
                        <Link href={`/marketing/blog/${row.slug}`} className={titleClass}>
                          {title}
                        </Link>
                      ) : (
                        <a href={`${websiteOrigin}/${locale}/blog/${row.slug}`} target="_blank" rel="noreferrer" className={titleClass}>
                          {title}
                        </a>
                      )}
                      {(searched || bookings !== undefined) && (
                        <p className="mt-1 flex flex-wrap gap-x-3 text-[12px] text-muted tabular-nums">
                          {searched && (
                            <>
                              <span>
                                {t.search.clicks} {searched.clicks}
                              </span>
                              <span>
                                {t.search.impressions} {searched.impressions}
                              </span>
                              <span>
                                {t.search.position} {searched.position.toFixed(1)}
                              </span>
                            </>
                          )}
                          {bookings !== undefined && (
                            <span>
                              {t.search.bookings} {Math.round(bookings)}
                            </span>
                          )}
                        </p>
                      )}
                    </div>
                    <span className="text-[13px] text-charcoal">{row.category ? (categoryLabels[row.category] ?? row.category) : "—"}</span>
                    <span className="text-right text-[13px] text-muted md:text-left">{row.published_at ? formatDateTime(row.published_at) : "—"}</span>
                    <span className="text-[13px] tabular-nums text-charcoal md:text-right">{row.views.toLocaleString("en-US")}</span>
                    <span className="text-right text-[13px] tabular-nums text-charcoal">{row.last7.toLocaleString("en-US")}</span>
                    <span>{row.state === "published" ? <FeaturedToggle slug={row.slug} featured={row.featured} canFeature={featuredCount < maxFeatured} labels={t.row} /> : <span className="text-muted">—</span>}</span>
                    <span className="flex flex-wrap justify-end gap-1 md:justify-start">
                      <Badge tone={tones[row.state]}>{t.state[row.state]}</Badge>
                      {row.dirty && <Badge tone="gold">{t.dirty}</Badge>}
                      {row.kind === "site" && <Badge tone="neutral">{t.row.pending}</Badge>}
                    </span>
                    <span className="col-span-2 text-right md:col-span-1">
                      {row.kind === "cms" ? (
                        <ButtonLink href={`/marketing/blog/${row.slug}`} size="sm" variant="secondary" className="h-7 px-2.5 text-xs">
                          {t.row.edit}
                        </ButtonLink>
                      ) : (
                        <VisibilityToggle slug={row.slug} hidden={row.state === "hidden"} labels={t.row} />
                      )}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
          <div className={`hidden gap-4 border-t border-ink/[0.07] bg-pearl/40 px-5 py-2.5 text-[13px] md:grid ${grid}`}>
            <span className="font-medium">{t.total}</span>
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
