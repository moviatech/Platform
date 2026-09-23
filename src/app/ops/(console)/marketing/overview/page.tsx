import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { PageHeader } from "@/components/ops/PageHeader";
import { parseRange, rangeChoices } from "@/features/marketing/dates";
import { change, decimal, exact, percent, whole } from "@/features/marketing/figures";
import { marketingMessages } from "@/features/marketing/i18n";
import { loadBriefs } from "@/features/marketing/brief";
import { loadOverview } from "@/features/marketing/overview";
import { signedCount, type ArticleMove, type ChannelMove, type FreshQuery, type IndexProblem } from "@/features/marketing/overview-math";
import { fill, named } from "@/features/marketing/text";
import { Choice, Delta, Notice, Panel, Ranked, Tile, type Column } from "@/features/marketing/ui/parts";
import { BriefFlag, BriefView } from "@/features/marketing/ui/BriefView";
import { PlacementPanel, PlacementShell } from "@/features/marketing/ui/PlacementPanel";
import { Trend } from "@/features/marketing/ui/Trend";
import { can, requirePagePermission } from "@/lib/auth/staff";
import { cn } from "@/lib/utils/cn";
import { formatDateTime } from "@/lib/utils/format";

export const metadata: Metadata = { title: "Overview" };

type Props = { searchParams: Promise<{ range?: string | string[] }> };

export default async function OverviewPage({ searchParams }: Props) {
  const session = await requirePagePermission("marketing.view");
  const days = parseRange((await searchParams).range);
  const { locale, messages } = await marketingMessages();
  const t = messages.overview;
  const g = messages.google;

  const [view, briefs] = await Promise.all([loadOverview(days), loadBriefs(1).catch(() => [])]);
  const brief = briefs[0] ?? null;
  const b = messages.insights;
  if (!view.configured.analytics && !view.configured.search) {
    return (
      <>
        <PageHeader title={t.title} />
        <Notice>{g.notConnected}</Notice>
      </>
    );
  }

  const editable = can(session, "blog.manage");
  const number = (value: number) => exact(value, locale);
  const traffic = view.traffic?.lastDay ? view.traffic : null;
  const search = view.search;
  const channelNames: Record<string, string> = messages.traffic.channel;
  const states: Record<string, string> = messages.search.verdict;
  const stateLabel = (problem: IndexProblem) => (problem.state === "missing" ? (named(states, problem.verdict || "VERDICT_UNSPECIFIED") ?? (problem.verdict || "VERDICT_UNSPECIFIED")) : states[problem.state]);
  const placementLabels = { title: t.placementTitle, missing: t.placementMissing, none: g.none, place: t.columns.place, count: t.columns.count, share: t.columns.share, names: t.placement as Record<string, string> };
  const title = (slug: string) => {
    const known = view.titles[slug];
    return (locale === "en" ? known?.en || known?.zh : known?.zh || known?.en) || slug;
  };
  const dash = "—";
  const syncText = view.sync.at ? fill(view.sync.failed ? t.syncFailed : t.synced, { time: formatDateTime(view.sync.at) }) : t.neverSynced;

  const articleName: Column<ArticleMove> = {
    key: "article",
    label: t.columns.article,
    cell: (move) =>
      editable && view.titles[move.slug] ? (
        <Link href={`/marketing/blog/${move.slug}`} className="hover:text-gold">
          {title(move.slug)}
        </Link>
      ) : (
        title(move.slug)
      ),
  };
  const articleColumns: Array<Column<ArticleMove>> = [
    { key: "impressions", label: t.columns.impressions, cell: (move) => number(move.impressions) },
    { key: "delta", label: t.columns.delta, cell: (move) => <span className={move.delta > 0 ? "text-status-available" : "text-status-danger"}>{signedCount(move.delta, number)}</span> },
    { key: "clicks", label: t.columns.clicks, cell: (move) => number(move.clicks) },
  ];
  const widest = (moves: ArticleMove[]) => Math.max(1, ...moves.map((move) => Math.abs(move.delta)));
  const freshTop = Math.max(1, ...(search?.fresh ?? []).map((line) => line.impressions));
  const channelTop = Math.max(1, ...(traffic?.channels ?? []).map((line) => line.sessions));

  return (
    <>
      <PageHeader title={t.title} />
      <div className="mb-5 flex flex-wrap items-center gap-2">
        {rangeChoices.map((choice) => (
          <Choice key={choice} href={`/marketing/overview?range=${choice}`} active={choice === days}>
            {g.ranges[String(choice) as keyof typeof g.ranges]}
          </Choice>
        ))}
        <span className="ml-2 text-[13px] text-muted">{fill(g.compare, { days })}</span>
        <span className={cn("ml-auto text-[12px]", view.sync.warn ? "font-medium text-status-danger" : "text-muted")} data-sync={view.sync.warn ? "warn" : "ok"}>
          {fill(t.until, { traffic: traffic?.lastDay ?? dash, search: search?.lastDay ?? dash })} · {syncText}
        </span>
      </div>

      <Panel
        title={b.brief}
        className="mb-5"
        aside={
          brief ? (
            <span className="flex items-center gap-2 text-[12px] text-muted" data-brief-week="">
              {fill(b.week, { start: brief.start, end: brief.end })}
              <BriefFlag flags={brief.flags} label={b.flagged} />
            </span>
          ) : undefined
        }
      >
        <div data-brief={brief?.key ?? ""}>{brief ? <BriefView brief={brief.content[locale]} labels={{ points: b.points, actions: b.actions, flagged: b.flagged }} /> : <p className="text-sm text-muted">{g.none}</p>}</div>
      </Panel>

      <div className="mb-5 grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
        <Tile label={t.tiles.sessions} value={traffic ? whole(traffic.current.sessions, locale) : dash} change={traffic ? change(traffic.current.sessions, traffic.previous.sessions) : undefined} />
        <Tile label={t.tiles.engagement} value={traffic ? percent(traffic.current.rate) : dash} change={traffic ? change(traffic.current.rate, traffic.previous.rate) : undefined} />
        <Tile label={t.tiles.bookings} value={traffic ? whole(traffic.current.keyEvents, locale) : dash} change={traffic ? change(traffic.current.keyEvents, traffic.previous.keyEvents) : undefined} />
        <Tile label={t.tiles.clicks} value={search ? whole(search.current.clicks, locale) : dash} change={search ? change(search.current.clicks, search.previous.clicks) : undefined} />
        <Tile label={t.tiles.impressions} value={search ? whole(search.current.impressions, locale) : dash} change={search ? change(search.current.impressions, search.previous.impressions) : undefined} />
        <Tile label={t.tiles.position} value={search && search.current.impressions ? decimal(search.current.position) : dash} change={search && search.current.impressions && search.previous.impressions ? change(search.current.position, search.previous.position) : undefined} better="down" />
      </div>

      <Panel title={t.trend} className="mb-5">
        <Trend
          series={[...(traffic ? [{ key: "sessions", label: t.tiles.sessions, points: traffic.sessions }] : []), ...(search ? [{ key: "clicks", label: t.tiles.clicks, points: search.clicks }] : [])]}
          locale={locale}
          labels={{ chart: g.chart, table: g.table, day: g.day, none: g.none }}
        />
      </Panel>

      <div className="grid gap-5 xl:grid-cols-2">
        <Panel title={t.articles} className="xl:col-span-2">
          {search && (search.rising.length || search.falling.length) ? (
            <div className="grid gap-6 lg:grid-cols-2">
              {(
                [
                  ["rising", t.rising, search.rising],
                  ["falling", t.falling, search.falling],
                ] as const
              ).map(([key, label, moves]) => (
                <div key={key} data-list={key} className="min-w-0">
                  <h3 className="mb-2 text-[12px] font-medium tracking-wide text-muted">{label}</h3>
                  <Ranked rows={[...moves]} rowKey={(move) => move.slug} name={articleName} columns={articleColumns} share={(move) => Math.abs(move.delta) / widest([...moves])} empty={g.none} />
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted">{g.none}</p>
          )}
        </Panel>

        <Panel title={t.fresh}>
          <Ranked<FreshQuery>
            rows={search?.fresh ?? []}
            rowKey={(line) => line.query}
            name={{ key: "query", label: t.columns.query, cell: (line) => line.query }}
            columns={[
              { key: "impressions", label: t.columns.impressions, cell: (line) => number(line.impressions) },
              { key: "clicks", label: t.columns.clicks, cell: (line) => number(line.clicks) },
              { key: "position", label: t.columns.position, cell: (line) => decimal(line.position) },
            ]}
            share={(line) => line.impressions / freshTop}
            empty={g.none}
          />
        </Panel>

        <Panel title={t.channels}>
          <Ranked<ChannelMove>
            rows={traffic?.channels ?? []}
            rowKey={(line) => line.name}
            name={{ key: "channel", label: t.columns.channel, cell: (line) => named(channelNames, line.name) ?? line.name }}
            columns={[
              { key: "sessions", label: t.columns.sessions, cell: (line) => number(line.sessions) },
              { key: "change", label: t.columns.change, cell: (line) => <Delta change={change(line.sessions, line.previous)} /> },
            ]}
            share={(line) => line.sessions / channelTop}
            empty={g.none}
          />
        </Panel>

        <Panel title={t.content} className="xl:col-span-2">
          <dl className="mb-4 grid grid-cols-2 gap-4 text-sm sm:grid-cols-4" data-counts="">
            {(
              [
                ["published", t.counts.published, number(view.counts.published)],
                ["drafts", t.counts.drafts, number(view.counts.drafts)],
                ["scheduled", t.counts.scheduled, number(view.counts.scheduled)],
                ["indexed", t.counts.indexed, view.index ? `${number(view.index.indexed)} / ${number(view.index.total)}` : dash],
              ] as const
            ).map(([key, label, value]) => (
              <div key={key} className="min-w-0">
                <dt className="text-xs text-muted">{label}</dt>
                <dd className="mt-1 text-lg font-semibold tabular-nums">{value}</dd>
              </div>
            ))}
          </dl>
          {view.index && view.index.problems.length > 0 && (
            <Ranked<IndexProblem>
              rows={view.index.problems}
              rowKey={(problem) => `${problem.slug}:${problem.language}`}
              name={{
                key: "page",
                label: t.columns.page,
                cell: (problem) => (
                  <Link href="/marketing/search" className="hover:text-gold">
                    {`/${problem.language}/blog/${problem.slug}`}
                  </Link>
                ),
              }}
              columns={[{ key: "state", label: t.columns.state, cell: (problem) => <span className={problem.state === "error" ? "text-status-danger" : undefined}>{stateLabel(problem)}</span> }]}
              empty={g.none}
            />
          )}
        </Panel>

        {view.configured.analytics && (
          <Suspense fallback={<PlacementShell labels={placementLabels} />}>
            <PlacementPanel days={days} locale={locale} labels={placementLabels} />
          </Suspense>
        )}
      </div>
    </>
  );
}
