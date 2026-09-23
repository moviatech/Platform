import "server-only";
import { articleOf, lastSearchDay, opportunities, searchLines, searchPeriod, searchSeries, searchTotals, type DayPoint, type SearchLine, type SearchTotals } from "./analysis";
import { cached, type Cached } from "./cache";
import { addDays, periodsEnding, zoneDay, type Period, type RangeDays } from "./dates";
import { listSitemaps, searchQuery } from "./google/client";
import { googleSettings } from "./google/config";
import type { GscFilter, Sitemap } from "./google/shape";

export const searchScopes = ["all", "blog"] as const;

export const searchLanguages = ["all", "zh", "en"] as const;

export type SearchScope = (typeof searchScopes)[number];

export type SearchLanguage = (typeof searchLanguages)[number];

export type SearchView = {
  lastDay: string | null;
  period: Period | null;
  previous: Period | null;
  totals: { current: SearchTotals; previous: SearchTotals };
  daily: { clicks: DayPoint[]; impressions: DayPoint[] };
  queries: SearchLine[];
  pages: SearchLine[];
  countries: SearchLine[];
  devices: SearchLine[];
  chances: SearchLine[];
};

export const parseScope = (value: unknown): SearchScope => searchScopes.find((item) => item === value) ?? "all";

export const parseLanguage = (value: unknown): SearchLanguage => searchLanguages.find((item) => item === value) ?? "all";

function filtersFor(scope: SearchScope, language: SearchLanguage): GscFilter[] {
  const filters: GscFilter[] = [];
  if (scope === "blog") filters.push({ dimension: "page", operator: "contains", expression: "/blog/" });
  if (language !== "all") filters.push({ dimension: "page", operator: "contains", expression: `/${language}/` });
  return filters;
}

const none: SearchTotals = { clicks: 0, impressions: 0, ctr: 0, position: 0 };

async function fetchSearch(days: RangeDays, scope: SearchScope, language: SearchLanguage, today: string): Promise<SearchView> {
  const filters = filtersFor(scope, language);
  const byDay = await searchQuery({ start: addDays(today, -(2 * days + 8)), end: addDays(today, -1), dimensions: ["date"], rowLimit: 1000, filters });
  const lastDay = lastSearchDay(byDay);
  if (!lastDay) return { lastDay: null, period: null, previous: null, totals: { current: none, previous: none }, daily: { clicks: [], impressions: [] }, queries: [], pages: [], countries: [], devices: [], chances: [] };
  const { current, previous } = periodsEnding(lastDay, days);
  const span = { start: current.start, end: current.end, filters };
  const [queries, pages, countries, devices] = await Promise.all([
    searchQuery({ ...span, dimensions: ["query"], rowLimit: 1000 }),
    searchQuery({ ...span, dimensions: ["page"], rowLimit: 250 }),
    searchQuery({ ...span, dimensions: ["country"], rowLimit: 25 }),
    searchQuery({ ...span, dimensions: ["device"], rowLimit: 5 }),
  ]);
  const ranked = searchLines(queries, 1000);
  return {
    lastDay,
    period: current,
    previous,
    totals: { current: searchPeriod(byDay, current), previous: searchPeriod(byDay, previous) },
    daily: { clicks: searchSeries(byDay, current, (row) => row.clicks), impressions: searchSeries(byDay, current, (row) => row.impressions) },
    queries: ranked.slice(0, 50),
    pages: searchLines(pages, 50),
    countries: searchLines(countries, 10),
    devices: searchLines(devices, 5),
    chances: opportunities(ranked),
  };
}

export function searchKey(site: string) {
  return `gsc:${site}:search:`;
}

export async function loadSearch(days: RangeDays, scope: SearchScope, language: SearchLanguage, now = new Date()): Promise<Cached<SearchView>> {
  const { site } = googleSettings();
  const today = zoneDay(now);
  return cached(`${searchKey(site ?? "none")}${days}:${scope}:${language}:${today}`, () => fetchSearch(days, scope, language, today));
}

export async function loadSitemaps(now = new Date()): Promise<Cached<Sitemap[]>> {
  const { site } = googleSettings();
  return cached(`${searchKey(site ?? "none")}sitemaps:${zoneDay(now)}`, () => listSitemaps());
}

export type ArticleSearch = SearchTotals;

async function fetchBlogSearch(today: string): Promise<Record<string, ArticleSearch>> {
  const recent = await searchQuery({ start: addDays(today, -12), end: addDays(today, -1), dimensions: ["date"], rowLimit: 20 });
  const lastDay = lastSearchDay(recent) ?? addDays(today, -3);
  const { current } = periodsEnding(lastDay, 28);
  const rows = await searchQuery({ start: current.start, end: current.end, dimensions: ["page"], rowLimit: 1000, filters: [{ dimension: "page", operator: "contains", expression: "/blog/" }] });
  const groups = new Map<string, typeof rows>();
  for (const row of rows) {
    const slug = articleOf(row.keys[0] ?? "");
    if (!slug) continue;
    const group = groups.get(slug);
    if (group) group.push(row);
    else groups.set(slug, [row]);
  }
  return Object.fromEntries([...groups].map(([slug, group]) => [slug, searchTotals(group)]));
}

export async function loadBlogSearch(now = new Date()): Promise<Cached<Record<string, ArticleSearch>>> {
  const { site } = googleSettings();
  const today = zoneDay(now);
  return cached(`${searchKey(site ?? "none")}blog:${today}`, () => fetchBlogSearch(today));
}

async function fetchArticleQueries(slug: string, today: string): Promise<SearchLine[]> {
  const rows = await searchQuery({ start: addDays(today, -93), end: addDays(today, -1), dimensions: ["query"], rowLimit: 200, filters: [{ dimension: "page", operator: "includingRegex", expression: `/(zh|en)/blog/${slug}/?$` }] });
  return searchLines(rows, 30);
}

export async function loadArticleQueries(slug: string, now = new Date()): Promise<Cached<SearchLine[]>> {
  const { site } = googleSettings();
  const today = zoneDay(now);
  return cached(`${searchKey(site ?? "none")}article:${slug}:${today}`, () => fetchArticleQueries(slug, today));
}
