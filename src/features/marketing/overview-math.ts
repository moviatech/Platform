import { articleOf, searchTotals, type DayPoint } from "./analysis";
import { addDays, listDays, periodsEnding, within, type Period } from "./dates";

export type Periods = { current: Period; previous: Period };

export type GaDayRow = { day: string; sessions: number; engaged: number; keyEvents: number };

export type GaChannelRow = { day: string; channel: string; sessions: number };

export type GscDayRow = { day: string; clicks: number; impressions: number; position: number };

export type CompareRow = { key: string; clicks: number; impressions: number; position: number; prevClicks: number; prevImpressions: number; prevPosition: number };

export type TrafficSums = { sessions: number; engaged: number; keyEvents: number; rate: number };

export type SearchSums = { clicks: number; impressions: number; position: number };

export type ChannelMove = { name: string; sessions: number; previous: number };

export type ArticleMove = { slug: string; impressions: number; previous: number; delta: number; clicks: number };

export type FreshQuery = { query: string; clicks: number; impressions: number; position: number };

export type ArticleCounts = { published: number; drafts: number; scheduled: number };

export type IndexState = "missing" | "error" | "none";

export type IndexProblem = { slug: string; language: "zh" | "en"; state: IndexState; verdict: string | null };

export type IndexCheck = { verdict: string | null; error: string | null } | null;

export type IndexSummary = { indexed: number; total: number; problems: IndexProblem[] };

export type SyncRun = { startedAt: string; finishedAt: string | null; ok: boolean | null };

export type SyncHealth = { at: string | null; failed: boolean; warn: boolean };

export function overviewPeriods(today: string, searchLast: string | null, days: number) {
  return { traffic: periodsEnding(addDays(today, -1), days), search: searchLast ? periodsEnding(searchLast, days) : null };
}

export function trafficSums(rows: GaDayRow[], period: Period): TrafficSums {
  let sessions = 0;
  let engaged = 0;
  let keyEvents = 0;
  for (const row of rows) {
    if (!within(row.day, period)) continue;
    sessions += row.sessions;
    engaged += row.engaged;
    keyEvents += row.keyEvents;
  }
  return { sessions, engaged, keyEvents, rate: sessions ? engaged / sessions : 0 };
}

export function searchSums(rows: GscDayRow[], period: Period): SearchSums {
  const { clicks, impressions, position } = searchTotals(rows.filter((row) => within(row.day, period)));
  return { clicks, impressions, position };
}

export function dailyPoints<Row extends { day: string }>(rows: Row[], period: Period, pick: (row: Row) => number): DayPoint[] {
  const byDay = new Map<string, number>();
  for (const row of rows) if (within(row.day, period)) byDay.set(row.day, (byDay.get(row.day) ?? 0) + pick(row));
  return listDays(period.start, period.end).map((day) => ({ day, value: byDay.get(day) ?? 0 }));
}

export function channelMoves(rows: GaChannelRow[], periods: Periods, limit = 6): ChannelMove[] {
  const merged = new Map<string, ChannelMove>();
  for (const row of rows) {
    const now = within(row.day, periods.current);
    if (!now && !within(row.day, periods.previous)) continue;
    const name = row.channel || "(not set)";
    const line = merged.get(name) ?? { name, sessions: 0, previous: 0 };
    if (now) line.sessions += row.sessions;
    else line.previous += row.sessions;
    merged.set(name, line);
  }
  return [...merged.values()]
    .filter((line) => line.sessions > 0)
    .sort((a, b) => b.sessions - a.sessions || b.previous - a.previous || a.name.localeCompare(b.name))
    .slice(0, limit);
}

export function articleMoves(rows: CompareRow[], limit = 5) {
  const merged = new Map<string, ArticleMove>();
  for (const row of rows) {
    const slug = articleOf(row.key);
    if (!slug || slug.startsWith("zz-mkt-")) continue;
    const entry = merged.get(slug) ?? { slug, impressions: 0, previous: 0, delta: 0, clicks: 0 };
    entry.impressions += row.impressions;
    entry.previous += row.prevImpressions;
    entry.clicks += row.clicks;
    entry.delta = entry.impressions - entry.previous;
    merged.set(slug, entry);
  }
  const all = [...merged.values()];
  return {
    rising: all.filter((entry) => entry.delta > 0).sort((a, b) => b.delta - a.delta || b.impressions - a.impressions || a.slug.localeCompare(b.slug)).slice(0, limit),
    falling: all.filter((entry) => entry.delta < 0).sort((a, b) => a.delta - b.delta || b.previous - a.previous || a.slug.localeCompare(b.slug)).slice(0, limit),
  };
}

export function freshQueries(rows: CompareRow[], limit = 10): FreshQuery[] {
  return rows
    .filter((row) => row.key && row.impressions > 0 && row.prevImpressions === 0)
    .sort((a, b) => b.impressions - a.impressions || b.clicks - a.clicks || a.key.localeCompare(b.key))
    .slice(0, limit)
    .map((row) => ({ query: row.key, clicks: row.clicks, impressions: row.impressions, position: row.position }));
}

export function articleCounts(rows: Array<{ slug: string; status: string; publishAt: string | null }>, now: Date): ArticleCounts {
  const counts: ArticleCounts = { published: 0, drafts: 0, scheduled: 0 };
  for (const row of rows) {
    if (row.slug.startsWith("zz-mkt-")) continue;
    if (row.status === "DRAFT") counts.drafts += 1;
    else if (row.status === "PUBLISHED") {
      if (row.publishAt && Date.parse(row.publishAt) > now.getTime()) counts.scheduled += 1;
      else counts.published += 1;
    }
  }
  return counts;
}

function stateOf(check: IndexCheck): IndexState | null {
  if (!check) return "none";
  if (check.error) return "error";
  return check.verdict === "PASS" ? null : "missing";
}

export function indexSummary(articles: Array<{ slug: string; zh: IndexCheck; en: IndexCheck }>, limit = 5): IndexSummary {
  let indexed = 0;
  let total = 0;
  const problems: IndexProblem[] = [];
  for (const article of articles) {
    if (article.slug.startsWith("zz-mkt-")) continue;
    for (const language of ["zh", "en"] as const) {
      total += 1;
      const state = stateOf(article[language]);
      if (state === null) indexed += 1;
      else problems.push({ slug: article.slug, language, state, verdict: article[language]?.verdict ?? null });
    }
  }
  const order: Record<IndexState, number> = { error: 0, missing: 1, none: 2 };
  return { indexed, total, problems: problems.sort((a, b) => order[a.state] - order[b.state]).slice(0, limit) };
}

export function syncHealth(runs: SyncRun[], now: Date, maxHours = 36): SyncHealth {
  const finished = runs.filter((run) => run.finishedAt).sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));
  const latest = finished[0] ?? null;
  const lastGood = finished.find((run) => run.ok === true) ?? null;
  const fresh = lastGood ? now.getTime() - Date.parse(lastGood.finishedAt ?? lastGood.startedAt) <= maxHours * 3600000 : false;
  const failed = latest?.ok === false;
  return { at: latest ? (latest.finishedAt ?? latest.startedAt) : null, failed, warn: failed || !fresh };
}

export function signedCount(value: number, format: (value: number) => string = String) {
  return value > 0 ? `+${format(value)}` : value < 0 ? `−${format(Math.abs(value))}` : "0";
}

export type PlacementLine = { name: string; count: number; share: number };

export function placementLines(rows: Array<{ name: string; count: number }>, limit = 10): PlacementLine[] {
  const kept = rows.filter((row) => row.name.trim() && row.name !== "(not set)" && row.count > 0);
  const total = kept.reduce((sum, row) => sum + row.count, 0);
  return kept
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, limit)
    .map((row) => ({ name: row.name, count: row.count, share: total ? row.count / total : 0 }));
}
