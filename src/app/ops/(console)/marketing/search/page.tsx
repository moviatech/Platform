import type { Metadata } from "next";
import type { ReactNode } from "react";
import { PageHeader } from "@/components/ops/PageHeader";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { refreshSearch } from "@/features/marketing/actions";
import type { SearchLine } from "@/features/marketing/analysis";
import { parseRange, rangeChoices } from "@/features/marketing/dates";
import { change, decimal, exact, percent, whole } from "@/features/marketing/figures";
import { googleFailure } from "@/features/marketing/google/client";
import { googleStatus } from "@/features/marketing/google/config";
import type { Sitemap } from "@/features/marketing/google/shape";
import { marketingMessages } from "@/features/marketing/i18n";
import { regionName } from "@/features/marketing/regions";
import { loadIndexStatus, type ArticleIndex, type UrlCheck } from "@/features/marketing/indexing";
import { loadSearch, loadSitemaps, parseLanguage, parseScope, searchLanguages, searchScopes } from "@/features/marketing/search";
import { fill } from "@/features/marketing/text";
import { IndexButton } from "@/features/marketing/ui/IndexButton";
import { Choice, Notice, Panel, Ranked, Tile, type Column } from "@/features/marketing/ui/parts";
import { Trend } from "@/features/marketing/ui/Trend";
import { requirePagePermission } from "@/lib/auth/staff";
import { rootDomain } from "@/lib/env";
import { formatDateTime } from "@/lib/utils/format";

export const metadata: Metadata = { title: "Search" };

type Props = { searchParams: Promise<{ range?: string | string[]; scope?: string | string[]; lang?: string | string[] }> };

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

const mainHost = `www.${rootDomain}`;

function pathOf(address: string) {
  const match = /^(https?):\/\/([^/]+)(.*)$/.exec(address);
  if (!match || match[1] !== "https") return address;
  return match[2] === mainHost ? match[3] || "/" : `${match[2]}${match[3]}`;
}

export default async function SearchPage({ searchParams }: Props) {
  await requirePagePermission("marketing.view");
  const params = await searchParams;
  const days = parseRange(params.range);
  const scope = parseScope(first(params.scope));
  const language = parseLanguage(first(params.lang));
  const { locale, messages } = await marketingMessages();
  const t = messages.search;
  const g = messages.google;
  const refresh = (
    <form action={refreshSearch}>
      <Button type="submit" size="sm" variant="secondary">
        {g.refresh}
      </Button>
    </form>
  );

  if (!googleStatus().search) {
    return (
      <>
        <PageHeader title={t.title} />
        <Notice>{g.notConnected}</Notice>
      </>
    );
  }

  const [report, indexing, maps] = await Promise.all([
    loadSearch(days, scope, language).catch((cause: unknown) => googleFailure(cause)),
    loadIndexStatus().catch(() => [] as ArticleIndex[]),
    loadSitemaps().catch(() => null),
  ]);
  if (typeof report === "string") {
    return (
      <>
        <PageHeader title={t.title} actions={refresh} />
        <Notice tone="warning">{fill(g.failed, { detail: report })}</Notice>
      </>
    );
  }

  const view = report.value;
  const now = view.totals.current;
  const before = view.totals.previous;
  const href = (next: { range?: number; scope?: string; lang?: string }) => `/marketing/search?range=${next.range ?? days}&scope=${next.scope ?? scope}&lang=${next.lang ?? language}`;
  const number = (value: number) => exact(value, locale);
  const deviceNames: Record<string, string> = t.device;
  const verdicts: Record<string, string> = t.verdict;
  const measures: Array<Column<SearchLine>> = [
    { key: "clicks", label: t.columns.clicks, cell: (line) => number(line.clicks) },
    { key: "impressions", label: t.columns.impressions, cell: (line) => number(line.impressions) },
    { key: "ctr", label: t.columns.ctr, cell: (line) => percent(line.ctr) },
    { key: "position", label: t.columns.position, cell: (line) => decimal(line.position) },
  ];
  const board = (title: string, label: string, lines: SearchLine[], name: (line: SearchLine) => ReactNode, options: { by?: "clicks" | "impressions"; className?: string } = {}) => {
    const by = options.by ?? "clicks";
    const most = Math.max(1, ...lines.map((line) => line[by]));
    return (
      <Panel title={title} className={options.className}>
        <Ranked rows={lines} rowKey={(line) => line.key} name={{ key: "name", label, cell: name }} columns={measures} share={(line) => line[by] / most} empty={g.none} />
      </Panel>
    );
  };
  const state = (check: UrlCheck | null) => {
    const key = !check ? "none" : check.error ? "error" : check.verdict || "VERDICT_UNSPECIFIED";
    const tone: BadgeTone = key === "PASS" ? "success" : key === "FAIL" || key === "error" ? "danger" : key === "none" ? "neutral" : "warning";
    return (
      <span title={check?.error ?? check?.coverage ?? undefined}>
        <Badge tone={tone}>{verdicts[key] ?? key}</Badge>
      </span>
    );
  };
  const crawled = (article: ArticleIndex) => {
    const times = [article.zh?.lastCrawl, article.en?.lastCrawl].filter((value): value is string => Boolean(value)).sort();
    return times.length ? formatDateTime(times[times.length - 1]) : "—";
  };

  return (
    <>
      <PageHeader title={t.title} actions={refresh} />
      <div className="mb-5 flex flex-wrap items-center gap-x-5 gap-y-2">
        <div className="flex flex-wrap gap-2">
          {rangeChoices.map((choice) => (
            <Choice key={choice} href={href({ range: choice })} active={choice === days}>
              {g.ranges[String(choice) as keyof typeof g.ranges]}
            </Choice>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          {searchScopes.map((choice) => (
            <Choice key={choice} href={href({ scope: choice })} active={choice === scope}>
              {t.scope[choice]}
            </Choice>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          {searchLanguages.map((choice) => (
            <Choice key={choice} href={href({ lang: choice })} active={choice === language}>
              {t.language[choice]}
            </Choice>
          ))}
        </div>
        <span className="ml-auto text-right text-[12px] text-muted">
          {view.lastDay ? `${fill(t.until, { day: view.lastDay })} · ${fill(g.compare, { days })} · ` : ""}
          {report.stale ? g.stale : fill(g.updated, { time: formatDateTime(report.fetchedAt) })}
        </span>
      </div>

      <div className="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Tile label={t.tiles.clicks} value={whole(now.clicks, locale)} change={change(now.clicks, before.clicks)} />
        <Tile label={t.tiles.impressions} value={whole(now.impressions, locale)} change={change(now.impressions, before.impressions)} />
        <Tile label={t.tiles.ctr} value={percent(now.ctr)} change={change(now.ctr, before.ctr)} />
        <Tile label={t.tiles.position} value={now.impressions ? decimal(now.position) : "—"} change={now.impressions && before.impressions ? change(now.position, before.position) : undefined} better="down" />
      </div>

      <Panel title={t.trend} className="mb-5">
        <Trend
          series={[
            { key: "clicks", label: t.tiles.clicks, points: view.daily.clicks },
            { key: "impressions", label: t.tiles.impressions, points: view.daily.impressions },
          ]}
          locale={locale}
          labels={{ chart: g.chart, table: g.table, day: g.day, none: g.none }}
        />
      </Panel>

      <div className="grid gap-5 xl:grid-cols-2">
        {board(t.queries, t.columns.query, view.queries.slice(0, 25), (line) => line.key)}
        {board(t.chances, t.columns.query, view.chances, (line) => line.key, { by: "impressions" })}
        {board(
          t.pages,
          t.columns.page,
          view.pages.slice(0, 25),
          (line) => (
            <a href={line.key} target="_blank" rel="noreferrer" className="hover:text-gold">
              {pathOf(line.key)}
            </a>
          ),
          { className: "xl:col-span-2" },
        )}
        {board(t.countries, t.columns.country, view.countries, (line) => regionName(line.key, locale))}
        {board(t.devices, t.columns.device, view.devices, (line) => deviceNames[line.key] ?? line.key)}

        <Panel title={t.indexing} className="xl:col-span-2">
          <Ranked<ArticleIndex>
            rows={indexing}
            rowKey={(article) => article.slug}
            name={{ key: "article", label: t.columns.article, cell: (article) => (locale === "zh" ? article.titleZh || article.titleEn : article.titleEn || article.titleZh) || article.slug }}
            columns={[
              { key: "zh", label: t.columns.zh, align: "left", cell: (article) => state(article.zh) },
              { key: "en", label: t.columns.en, align: "left", cell: (article) => state(article.en) },
              { key: "crawled", label: t.columns.crawled, cell: crawled },
              { key: "check", label: "", cell: (article) => <IndexButton slug={article.slug} label={t.check} /> },
            ]}
            empty={g.none}
          />
        </Panel>

        <Panel title={t.sitemaps} className="xl:col-span-2">
          <Ranked<Sitemap>
            rows={maps?.value ?? []}
            rowKey={(map) => map.path}
            name={{ key: "sitemap", label: t.columns.sitemap, cell: (map) => map.path }}
            columns={[
              { key: "submitted", label: t.columns.submitted, cell: (map) => number(map.submitted) },
              { key: "indexed", label: t.columns.indexed, cell: (map) => (map.indexed === null ? "—" : number(map.indexed)) },
              { key: "downloaded", label: t.columns.downloaded, cell: (map) => (map.pending ? t.pending : map.lastDownloaded ? formatDateTime(map.lastDownloaded) : "—") },
              { key: "problems", label: t.columns.problems, cell: (map) => number(map.errors + map.warnings) },
            ]}
            empty={g.none}
          />
        </Panel>
      </div>
    </>
  );
}
