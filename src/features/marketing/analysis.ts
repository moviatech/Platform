import { listDays, within, type Period } from "./dates";
import type { GaRow, GscRow } from "./google/shape";

export type SearchTotals = { clicks: number; impressions: number; ctr: number; position: number };

export type SearchLine = SearchTotals & { key: string };

export type DayPoint = { day: string; value: number };

export function searchTotals(rows: Array<Pick<GscRow, "clicks" | "impressions" | "position">>): SearchTotals {
  let clicks = 0;
  let impressions = 0;
  let weighted = 0;
  for (const row of rows) {
    clicks += row.clicks;
    impressions += row.impressions;
    weighted += row.position * row.impressions;
  }
  return { clicks, impressions, ctr: impressions ? clicks / impressions : 0, position: impressions ? weighted / impressions : 0 };
}

export function searchLines(rows: GscRow[], limit: number): SearchLine[] {
  return rows
    .filter((row) => row.keys[0])
    .sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions || a.position - b.position)
    .slice(0, limit)
    .map((row) => ({ key: row.keys[0], clicks: row.clicks, impressions: row.impressions, ctr: row.impressions ? row.clicks / row.impressions : 0, position: row.position }));
}

export function lastSearchDay(rows: GscRow[]) {
  let last = "";
  for (const row of rows) if (row.keys[0] > last && (row.impressions > 0 || row.clicks > 0)) last = row.keys[0];
  return last || null;
}

export function searchSeries(rows: GscRow[], period: Period, pick: (row: GscRow) => number): DayPoint[] {
  const byDay = new Map(rows.map((row) => [row.keys[0], row]));
  return listDays(period.start, period.end).map((day) => {
    const row = byDay.get(day);
    return { day, value: row ? pick(row) : 0 };
  });
}

export function searchPeriod(rows: GscRow[], period: Period) {
  return searchTotals(rows.filter((row) => within(row.keys[0], period)));
}

export function opportunities(lines: SearchLine[], limit = 15) {
  return lines
    .filter((line) => line.position >= 4 && line.position <= 20 && line.impressions >= 10 && line.ctr <= 0.05)
    .sort((a, b) => b.impressions - a.impressions || a.position - b.position)
    .slice(0, limit);
}

export type LanguageShare = { key: "zh" | "en" | "other"; sessions: number; engaged: number; keyEvents: number };

export function languageShares(rows: GaRow[]): LanguageShare[] {
  const shares: Record<LanguageShare["key"], LanguageShare> = { zh: { key: "zh", sessions: 0, engaged: 0, keyEvents: 0 }, en: { key: "en", sessions: 0, engaged: 0, keyEvents: 0 }, other: { key: "other", sessions: 0, engaged: 0, keyEvents: 0 } };
  for (const row of rows) {
    const path = row.dims.landingPage ?? "";
    const key = /^\/zh(?:\/|$|\?)/.test(path) ? "zh" : /^\/en(?:\/|$|\?)/.test(path) ? "en" : "other";
    shares[key].sessions += row.metrics.sessions ?? 0;
    shares[key].engaged += row.metrics.engagedSessions ?? 0;
    shares[key].keyEvents += row.metrics.keyEvents ?? 0;
  }
  return [shares.zh, shares.en, shares.other];
}

export type FunnelStep = { event: string; users: number; share: number | null };

export function funnelSteps(rows: GaRow[], events: readonly string[]): FunnelStep[] {
  const users = new Map(rows.map((row) => [row.dims.eventName ?? "", row.metrics.activeUsers ?? 0]));
  return events.map((event, index) => {
    const count = users.get(event) ?? 0;
    const before = index === 0 ? null : (users.get(events[index - 1]) ?? 0);
    return { event, users: count, share: before === null ? null : before > 0 ? count / before : null };
  });
}

export function gaSeries(rows: GaRow[], period: Period, metric: string): DayPoint[] {
  const byDay = new Map(rows.map((row) => [row.dims.date ?? "", row.metrics[metric] ?? 0]));
  return listDays(period.start, period.end).map((day) => ({ day, value: byDay.get(day) ?? 0 }));
}

export function topPerDay<Row extends { day: string; clicks: number; impressions: number }>(rows: Row[], limit: number) {
  const byDay = new Map<string, Row[]>();
  for (const row of rows) {
    const group = byDay.get(row.day);
    if (group) group.push(row);
    else byDay.set(row.day, [row]);
  }
  const kept: Row[] = [];
  for (const group of byDay.values()) kept.push(...group.sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions).slice(0, limit));
  return kept;
}

export function articleOf(path: string) {
  const match = /^(?:https?:\/\/[^/]+)?\/(?:zh|en)\/blog\/([a-z0-9]+(?:-[a-z0-9]+)*)\/?(?:[?#].*)?$/.exec(path);
  return match ? match[1] : null;
}
