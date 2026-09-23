import "server-only";
import { funnelSteps, gaSeries, languageShares, type DayPoint, type FunnelStep, type LanguageShare } from "./analysis";
import { cached, type Cached } from "./cache";
import { addDays, periodsEnding, zoneDay, type Period, type RangeDays } from "./dates";
import { runReports } from "./google/client";
import { googleSettings } from "./google/config";
import type { GaRequest, GaRow } from "./google/shape";

export const funnelEvents = ["vehicle_view", "book_cta_click", "booking_request_submit", "booking_request_success"] as const;

export type TrafficTotals = { users: number; sessions: number; engaged: number; seconds: number; keyEvents: number; views: number };

export type TrafficLine = { name: string; sessions: number; users: number; engaged: number; keyEvents: number };

export type TrafficView = {
  period: Period;
  previous: Period;
  totals: { current: TrafficTotals; previous: TrafficTotals };
  daily: { sessions: DayPoint[]; users: DayPoint[]; keyEvents: DayPoint[] };
  channels: TrafficLine[];
  sources: TrafficLine[];
  landing: TrafficLine[];
  languages: LanguageShare[];
  countries: TrafficLine[];
  devices: TrafficLine[];
  funnel: FunnelStep[];
};

const empty: TrafficTotals = { users: 0, sessions: 0, engaged: 0, seconds: 0, keyEvents: 0, views: 0 };

function totalsOf(rows: GaRow[], range: number): TrafficTotals {
  const row = rows.find((item) => item.range === range);
  if (!row) return empty;
  const metric = row.metrics;
  return { users: metric.activeUsers ?? 0, sessions: metric.sessions ?? 0, engaged: metric.engagedSessions ?? 0, seconds: metric.userEngagementDuration ?? 0, keyEvents: metric.keyEvents ?? 0, views: metric.screenPageViews ?? 0 };
}

const unset = "(not set)";

function lines(rows: GaRow[], dimension: string, limit: number): TrafficLine[] {
  const merged = new Map<string, TrafficLine>();
  for (const row of rows) {
    const name = row.dims[dimension] || unset;
    const line = merged.get(name) ?? { name, sessions: 0, users: 0, engaged: 0, keyEvents: 0 };
    line.sessions += row.metrics.sessions ?? 0;
    line.users += row.metrics.activeUsers ?? 0;
    line.engaged += row.metrics.engagedSessions ?? 0;
    line.keyEvents += row.metrics.keyEvents ?? 0;
    merged.set(name, line);
  }
  return [...merged.values()].sort((a, b) => b.sessions - a.sessions).slice(0, limit);
}

async function fetchTraffic(days: RangeDays, lastDay: string): Promise<TrafficView> {
  const { current, previous } = periodsEnding(lastDay, days);
  const now = [current];
  const bySessions = { metric: "sessions", descending: true };
  const requests: GaRequest[] = [
    { ranges: [current, previous], metrics: ["activeUsers", "sessions", "engagedSessions", "userEngagementDuration", "keyEvents", "screenPageViews"] },
    { ranges: now, dimensions: ["date"], metrics: ["sessions", "activeUsers", "keyEvents"], orderBy: { dimension: "date" }, keepEmptyRows: true, limit: 400 },
    { ranges: now, dimensions: ["sessionDefaultChannelGroup"], metrics: ["sessions", "activeUsers", "engagedSessions", "keyEvents"], orderBy: bySessions, limit: 12 },
    { ranges: now, dimensions: ["sessionSourceMedium"], metrics: ["sessions", "activeUsers", "engagedSessions", "keyEvents"], orderBy: bySessions, limit: 12 },
    { ranges: now, dimensions: ["landingPage"], metrics: ["sessions", "engagedSessions", "keyEvents"], orderBy: bySessions, limit: 250 },
    { ranges: now, dimensions: ["countryId"], metrics: ["sessions", "activeUsers"], orderBy: bySessions, limit: 10 },
    { ranges: now, dimensions: ["deviceCategory"], metrics: ["sessions", "activeUsers"], orderBy: bySessions, limit: 5 },
    { ranges: now, dimensions: ["eventName"], metrics: ["activeUsers"], filter: { kind: "in", field: "eventName", values: [...funnelEvents] } },
  ];
  const [totals, daily, channels, sources, landing, countries, devices, funnel] = await runReports(requests);
  return {
    period: current,
    previous,
    totals: { current: totalsOf(totals, 0), previous: totalsOf(totals, 1) },
    daily: { sessions: gaSeries(daily, current, "sessions"), users: gaSeries(daily, current, "activeUsers"), keyEvents: gaSeries(daily, current, "keyEvents") },
    channels: lines(channels, "sessionDefaultChannelGroup", 12),
    sources: lines(sources, "sessionSourceMedium", 12),
    landing: lines(landing, "landingPage", 20),
    languages: languageShares(landing),
    countries: lines(countries, "countryId", 10),
    devices: lines(devices, "deviceCategory", 5),
    funnel: funnelSteps(funnel, funnelEvents),
  };
}

export function trafficKey(property: string) {
  return `ga:${property}:traffic:`;
}

export async function loadTraffic(days: RangeDays, now = new Date()): Promise<Cached<TrafficView>> {
  const { property } = googleSettings();
  const lastDay = addDays(zoneDay(now), -1);
  return cached(`${trafficKey(property ?? "none")}${days}:${lastDay}`, () => fetchTraffic(days, lastDay));
}

export type LandingStat = { sessions: number; keyEvents: number };

async function fetchBlogLanding(lastDay: string): Promise<Record<string, LandingStat>> {
  const { current } = periodsEnding(lastDay, 28);
  const [rows] = await runReports([{ ranges: [current], dimensions: ["landingPage"], metrics: ["sessions", "keyEvents"], filter: { kind: "contains", field: "landingPage", value: "/blog/" }, orderBy: { metric: "sessions", descending: true }, limit: 1000 }]);
  const stats: Record<string, LandingStat> = {};
  for (const row of rows) {
    const match = /^\/(?:zh|en)\/blog\/([a-z0-9]+(?:-[a-z0-9]+)*)\/?$/.exec((row.dims.landingPage ?? "").split("?")[0]);
    if (!match) continue;
    const entry = (stats[match[1]] ??= { sessions: 0, keyEvents: 0 });
    entry.sessions += row.metrics.sessions ?? 0;
    entry.keyEvents += row.metrics.keyEvents ?? 0;
  }
  return stats;
}

export async function loadBlogLanding(now = new Date()): Promise<Cached<Record<string, LandingStat>>> {
  const { property } = googleSettings();
  const lastDay = addDays(zoneDay(now), -1);
  return cached(`ga:${property ?? "none"}:blog-landing:${lastDay}`, () => fetchBlogLanding(lastDay));
}
