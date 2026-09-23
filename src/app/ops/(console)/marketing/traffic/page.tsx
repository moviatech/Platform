import type { Metadata } from "next";
import { PageHeader } from "@/components/ops/PageHeader";
import { Button } from "@/components/ui/Button";
import { refreshTraffic } from "@/features/marketing/actions";
import type { FunnelStep, LanguageShare } from "@/features/marketing/analysis";
import { parseRange, rangeChoices } from "@/features/marketing/dates";
import { change, duration, exact, percent, whole } from "@/features/marketing/figures";
import { googleFailure } from "@/features/marketing/google/client";
import { googleStatus } from "@/features/marketing/google/config";
import { marketingMessages } from "@/features/marketing/i18n";
import { regionName } from "@/features/marketing/regions";
import { fill } from "@/features/marketing/text";
import { loadTraffic, type TrafficLine, type TrafficTotals } from "@/features/marketing/traffic";
import { Choice, Notice, Panel, Ranked, Tile, type Column } from "@/features/marketing/ui/parts";
import { Trend } from "@/features/marketing/ui/Trend";
import { requirePagePermission } from "@/lib/auth/staff";
import { websiteOrigin } from "@/lib/env";
import { formatDateTime } from "@/lib/utils/format";

export const metadata: Metadata = { title: "Traffic" };

type Props = { searchParams: Promise<{ range?: string | string[] }> };

const rate = (line: { sessions: number; engaged: number }) => (line.sessions ? line.engaged / line.sessions : 0);

const perUser = (totals: TrafficTotals) => (totals.users ? totals.seconds / totals.users : 0);

export default async function TrafficPage({ searchParams }: Props) {
  await requirePagePermission("marketing.view");
  const days = parseRange((await searchParams).range);
  const { locale, messages } = await marketingMessages();
  const t = messages.traffic;
  const g = messages.google;
  const refresh = (
    <form action={refreshTraffic}>
      <Button type="submit" size="sm" variant="secondary">
        {g.refresh}
      </Button>
    </form>
  );

  if (!googleStatus().analytics) {
    return (
      <>
        <PageHeader title={t.title} />
        <Notice>{g.notConnected}</Notice>
      </>
    );
  }

  const report = await loadTraffic(days).catch((cause: unknown) => googleFailure(cause));
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
  const channelNames: Record<string, string> = t.channel;
  const deviceNames: Record<string, string> = t.device;
  const stepNames: Record<string, string> = t.steps;
  const number = (value: number) => exact(value, locale);
  const most = (lines: Array<{ sessions: number }>) => Math.max(1, ...lines.map((line) => line.sessions));
  const counts: Array<Column<TrafficLine>> = [
    { key: "sessions", label: t.columns.sessions, cell: (line) => number(line.sessions) },
    { key: "users", label: t.columns.users, cell: (line) => number(line.users) },
    { key: "engagement", label: t.columns.engagement, cell: (line) => percent(rate(line)) },
    { key: "keyEvents", label: t.columns.keyEvents, cell: (line) => number(line.keyEvents) },
  ];
  const brief: Array<Column<TrafficLine>> = [counts[0], counts[1]];
  const firstStep = Math.max(1, view.funnel[0]?.users ?? 0);
  const languages = view.languages.filter((share) => share.key !== "other" || share.sessions > 0);
  const languageTop = Math.max(1, ...languages.map((share) => share.sessions));

  return (
    <>
      <PageHeader title={t.title} actions={refresh} />
      <div className="mb-5 flex flex-wrap items-center gap-2">
        {rangeChoices.map((choice) => (
          <Choice key={choice} href={`/marketing/traffic?range=${choice}`} active={choice === days}>
            {g.ranges[String(choice) as keyof typeof g.ranges]}
          </Choice>
        ))}
        <span className="ml-2 text-[13px] text-muted">{fill(g.compare, { days })}</span>
        <span className="ml-auto text-[12px] text-muted">{report.stale ? g.stale : fill(g.updated, { time: formatDateTime(report.fetchedAt) })}</span>
      </div>

      <div className="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-5">
        <Tile label={t.tiles.users} value={whole(now.users, locale)} change={change(now.users, before.users)} />
        <Tile label={t.tiles.sessions} value={whole(now.sessions, locale)} change={change(now.sessions, before.sessions)} />
        <Tile label={t.tiles.engagement} value={percent(rate(now))} change={change(rate(now), rate(before))} />
        <Tile label={t.tiles.time} value={duration(perUser(now), locale)} change={change(perUser(now), perUser(before))} />
        <Tile label={t.tiles.keyEvents} value={whole(now.keyEvents, locale)} change={change(now.keyEvents, before.keyEvents)} />
      </div>

      <Panel title={t.trend} className="mb-5">
        <Trend
          series={[
            { key: "sessions", label: t.tiles.sessions, points: view.daily.sessions },
            { key: "users", label: t.tiles.users, points: view.daily.users },
            { key: "keyEvents", label: t.tiles.keyEvents, points: view.daily.keyEvents },
          ]}
          locale={locale}
          labels={{ chart: g.chart, table: g.table, day: g.day, none: g.none }}
        />
      </Panel>

      <div className="grid gap-5 xl:grid-cols-2">
        <Panel title={t.channels}>
          <Ranked rows={view.channels} rowKey={(line) => line.name} name={{ key: "name", label: t.columns.name, cell: (line) => channelNames[line.name] ?? line.name }} columns={counts} share={(line) => line.sessions / most(view.channels)} empty={g.none} />
        </Panel>
        <Panel title={t.sources}>
          <Ranked rows={view.sources} rowKey={(line) => line.name} name={{ key: "name", label: t.columns.name, cell: (line) => (line.name && line.name !== "(not set)" ? line.name : t.notSet) }} columns={counts} share={(line) => line.sessions / most(view.sources)} empty={g.none} />
        </Panel>
        <Panel title={t.landing} className="xl:col-span-2">
          <Ranked
            rows={view.landing}
            rowKey={(line) => line.name}
            name={{
              key: "page",
              label: t.columns.page,
              cell: (line) =>
                line.name.startsWith("/") ? (
                  <a href={`${websiteOrigin}${line.name}`} target="_blank" rel="noreferrer" className="hover:text-gold">
                    {line.name}
                  </a>
                ) : line.name && line.name !== "(not set)" ? (
                  line.name
                ) : (
                  t.notSet
                ),
            }}
            columns={[counts[0], counts[2], counts[3]]}
            share={(line) => line.sessions / most(view.landing)}
            empty={g.none}
          />
        </Panel>
        <Panel title={t.funnel}>
          <Ranked<FunnelStep>
            rows={view.funnel}
            rowKey={(step) => step.event}
            name={{ key: "step", label: t.columns.step, cell: (step) => stepNames[step.event] ?? step.event }}
            columns={[
              { key: "users", label: t.columns.users, cell: (step) => number(step.users) },
              { key: "next", label: t.columns.next, cell: (step) => (step.share === null ? "—" : percent(step.share)) },
            ]}
            share={(step) => step.users / firstStep}
            empty={g.none}
          />
        </Panel>
        <Panel title={t.languages}>
          <Ranked<LanguageShare>
            rows={languages}
            rowKey={(share) => share.key}
            name={{ key: "name", label: t.columns.name, cell: (share) => t.language[share.key] }}
            columns={[
              { key: "sessions", label: t.columns.sessions, cell: (share) => number(share.sessions) },
              { key: "engagement", label: t.columns.engagement, cell: (share) => percent(rate(share)) },
              { key: "keyEvents", label: t.columns.keyEvents, cell: (share) => number(share.keyEvents) },
            ]}
            share={(share) => share.sessions / languageTop}
            empty={g.none}
          />
        </Panel>
        <Panel title={t.countries}>
          <Ranked rows={view.countries} rowKey={(line) => line.name} name={{ key: "name", label: t.columns.name, cell: (line) => regionName(line.name, locale) }} columns={brief} share={(line) => line.sessions / most(view.countries)} empty={g.none} />
        </Panel>
        <Panel title={t.devices}>
          <Ranked rows={view.devices} rowKey={(line) => line.name} name={{ key: "name", label: t.columns.name, cell: (line) => deviceNames[line.name] ?? line.name }} columns={brief} share={(line) => line.sessions / most(view.devices)} empty={g.none} />
        </Panel>
      </div>
    </>
  );
}
