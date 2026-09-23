import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { DayPoint } from "./analysis";
import { zoneDay, type RangeDays } from "./dates";
import { googleSettings } from "./google/config";
import { loadIndexStatus } from "./indexing";
import {
  articleCounts,
  articleMoves,
  channelMoves,
  dailyPoints,
  freshQueries,
  indexSummary,
  overviewPeriods,
  searchSums,
  syncHealth,
  trafficSums,
  type ArticleCounts,
  type ArticleMove,
  type ChannelMove,
  type CompareRow,
  type FreshQuery,
  type GaChannelRow,
  type GaDayRow,
  type GscDayRow,
  type IndexSummary,
  type Periods,
  type SearchSums,
  type SyncHealth,
  type TrafficSums,
} from "./overview-math";

export type Admin = ReturnType<typeof createAdminClient>;

export type OverviewTraffic = { periods: Periods; lastDay: string | null; current: TrafficSums; previous: TrafficSums; sessions: DayPoint[]; channels: ChannelMove[] };

export type OverviewSearch = { periods: Periods; lastDay: string; current: SearchSums; previous: SearchSums; clicks: DayPoint[]; rising: ArticleMove[]; falling: ArticleMove[]; fresh: FreshQuery[] };

export type OverviewView = {
  configured: { analytics: boolean; search: boolean };
  traffic: OverviewTraffic | null;
  search: OverviewSearch | null;
  titles: Record<string, { zh: string; en: string }>;
  counts: ArticleCounts;
  index: IndexSummary | null;
  sync: SyncHealth;
};

const pageSize = 1000;

export async function everyRow<Row>(load: (from: number, to: number) => PromiseLike<{ data: Row[] | null; error: { message: string } | null }>) {
  const rows: Row[] = [];
  for (let from = 0; from < 20000; from += pageSize) {
    const { data, error } = await load(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
    if (!data || data.length < pageSize) break;
  }
  return rows;
}

export const asNumber = (value: unknown) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
};

async function loadTraffic(supabase: Admin, property: string, today: string, days: RangeDays): Promise<OverviewTraffic> {
  const { traffic: periods } = overviewPeriods(today, null, days);
  const from = periods.previous.start;
  const to = periods.current.end;
  const [daily, channels, last] = await Promise.all([
    everyRow((start, end) => supabase.from("marketing_ga_daily").select("day, sessions, engaged_sessions, key_events").eq("property", property).gte("day", from).lte("day", to).order("day").range(start, end)),
    everyRow((start, end) => supabase.from("marketing_ga_channel_daily").select("day, channel, sessions").eq("property", property).gte("day", from).lte("day", to).order("day").order("channel").range(start, end)),
    supabase.from("marketing_ga_daily").select("day").eq("property", property).order("day", { ascending: false }).limit(1).maybeSingle(),
  ]);
  if (last.error) throw new Error(last.error.message);
  const rows: GaDayRow[] = daily.map((row) => ({ day: String(row.day), sessions: asNumber(row.sessions), engaged: asNumber(row.engaged_sessions), keyEvents: asNumber(row.key_events) }));
  const byChannel: GaChannelRow[] = channels.map((row) => ({ day: String(row.day), channel: String(row.channel), sessions: asNumber(row.sessions) }));
  return {
    periods,
    lastDay: (last.data?.day as string | undefined) ?? null,
    current: trafficSums(rows, periods.current),
    previous: trafficSums(rows, periods.previous),
    sessions: dailyPoints(rows, periods.current, (row) => row.sessions),
    channels: channelMoves(byChannel, periods),
  };
}

export async function compare(supabase: Admin, name: "marketing_gsc_page_compare" | "marketing_gsc_query_compare", site: string, periods: Periods): Promise<CompareRow[]> {
  const { data, error } = await supabase.rpc(name, { p_site: site, p_from: periods.current.start, p_to: periods.current.end, p_prev_from: periods.previous.start, p_prev_to: periods.previous.end });
  if (error) throw new Error(error.message);
  const column = name === "marketing_gsc_page_compare" ? "page" : "query";
  return ((data ?? []) as Array<Record<string, unknown>>).map((row) => ({
    key: String(row[column] ?? ""),
    clicks: asNumber(row.clicks),
    impressions: asNumber(row.impressions),
    position: asNumber(row.position),
    prevClicks: asNumber(row.prev_clicks),
    prevImpressions: asNumber(row.prev_impressions),
    prevPosition: asNumber(row.prev_position),
  }));
}

async function loadSearch(supabase: Admin, site: string, today: string, days: RangeDays): Promise<OverviewSearch | null> {
  const { data: last, error } = await supabase.from("marketing_gsc_daily").select("day").eq("site", site).gt("impressions", 0).order("day", { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error(error.message);
  const { search: periods } = overviewPeriods(today, (last?.day as string | undefined) ?? null, days);
  if (!periods) return null;
  const [daily, pages, queries] = await Promise.all([
    everyRow((start, end) => supabase.from("marketing_gsc_daily").select("day, clicks, impressions, position").eq("site", site).gte("day", periods.previous.start).lte("day", periods.current.end).order("day").range(start, end)),
    compare(supabase, "marketing_gsc_page_compare", site, periods),
    compare(supabase, "marketing_gsc_query_compare", site, periods),
  ]);
  const rows: GscDayRow[] = daily.map((row) => ({ day: String(row.day), clicks: asNumber(row.clicks), impressions: asNumber(row.impressions), position: asNumber(row.position) }));
  const moves = articleMoves(pages);
  return {
    periods,
    lastDay: periods.current.end,
    current: searchSums(rows, periods.current),
    previous: searchSums(rows, periods.previous),
    clicks: dailyPoints(rows, periods.current, (row) => row.clicks),
    rising: moves.rising,
    falling: moves.falling,
    fresh: freshQueries(queries),
  };
}

export async function loadArticles(supabase: Admin) {
  const rows = await everyRow((start, end) => supabase.from("blog_articles").select("slug, status, publish_at, title_zh, title_en, category").not("slug", "like", "zz-mkt-%").order("slug").range(start, end));
  return rows.map((row) => ({ slug: String(row.slug), status: String(row.status), publishAt: (row.publish_at as string | null) ?? null, zh: String(row.title_zh ?? ""), en: String(row.title_en ?? ""), category: (row.category as string | null) ?? null }));
}

async function loadRuns(supabase: Admin, property: string | null, site: string | null) {
  let query = supabase.from("marketing_sync_runs").select("started_at, finished_at, ok").order("started_at", { ascending: false }).limit(10);
  if (property) query = query.eq("detail->scope->>property", property);
  else if (site) query = query.eq("detail->scope->>site", site);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => ({ startedAt: String(row.started_at), finishedAt: (row.finished_at as string | null) ?? null, ok: (row.ok as boolean | null) ?? null }));
}

export async function loadOverview(days: RangeDays, now = new Date()): Promise<OverviewView> {
  const { account, property, site } = googleSettings();
  const configured = { analytics: Boolean(account && property), search: Boolean(account && site) };
  const supabase = createAdminClient();
  const today = zoneDay(now);
  const [traffic, search, articles, index, runs] = await Promise.all([
    configured.analytics && property ? loadTraffic(supabase, property, today, days) : null,
    configured.search && site ? loadSearch(supabase, site, today, days) : null,
    loadArticles(supabase),
    configured.search ? loadIndexStatus().then((list) => indexSummary(list)) : null,
    loadRuns(supabase, property, site),
  ]);
  return {
    configured,
    traffic,
    search,
    titles: Object.fromEntries(articles.map((article) => [article.slug, { zh: article.zh, en: article.en }])),
    counts: articleCounts(articles, now),
    index,
    sync: syncHealth(runs, now),
  };
}
