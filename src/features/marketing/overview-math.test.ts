import { describe, expect, it } from "vitest";
import { addDays, listDays } from "./dates";
import { articleCounts, articleMoves, channelMoves, dailyPoints, freshQueries, indexSummary, overviewPeriods, placementLines, searchSums, signedCount, syncHealth, trafficSums, type CompareRow } from "./overview-math";
import { named } from "./text";

const row = (key: string, impressions: number, prevImpressions: number, clicks = 0, position = 5): CompareRow => ({ key, clicks, impressions, position, prevClicks: 0, prevImpressions, prevPosition: 0 });

describe("overview periods", () => {
  it("ends traffic yesterday and search on its last stored day, each with an equally long period before", () => {
    const periods = overviewPeriods("2026-11-24", "2026-11-21", 7);
    expect(periods.traffic).toEqual({ current: { start: "2026-11-17", end: "2026-11-23" }, previous: { start: "2026-11-10", end: "2026-11-16" } });
    expect(periods.search).toEqual({ current: { start: "2026-11-15", end: "2026-11-21" }, previous: { start: "2026-11-08", end: "2026-11-14" } });
  });

  it("has no search period before any search day is stored", () => {
    expect(overviewPeriods("2026-11-24", null, 28).search).toBeNull();
  });

  it("crosses month and year ends", () => {
    const periods = overviewPeriods("2027-01-02", "2026-12-30", 90);
    expect(periods.traffic.current).toEqual({ start: "2026-10-04", end: "2027-01-01" });
    expect(listDays(periods.traffic.previous.start, periods.traffic.previous.end)).toHaveLength(90);
    expect(addDays(periods.search!.previous.end, 1)).toBe(periods.search!.current.start);
  });
});

describe("period sums", () => {
  const period = { start: "2026-11-10", end: "2026-11-12" };

  it("adds sessions, engaged sessions and bookings inside the period only", () => {
    const rows = [
      { day: "2026-11-09", sessions: 100, engaged: 90, keyEvents: 9 },
      { day: "2026-11-10", sessions: 40, engaged: 20, keyEvents: 1 },
      { day: "2026-11-12", sessions: 60, engaged: 30, keyEvents: 0.5 },
    ];
    expect(trafficSums(rows, period)).toEqual({ sessions: 100, engaged: 50, keyEvents: 1.5, rate: 0.5 });
  });

  it("weights the average position by impressions", () => {
    const rows = [
      { day: "2026-11-10", clicks: 2, impressions: 100, position: 4 },
      { day: "2026-11-11", clicks: 1, impressions: 300, position: 8 },
      { day: "2026-11-20", clicks: 50, impressions: 900, position: 1 },
    ];
    expect(searchSums(rows, period)).toEqual({ clicks: 3, impressions: 400, position: 7 });
  });

  it("gives zeros for an empty period", () => {
    expect(trafficSums([], period)).toEqual({ sessions: 0, engaged: 0, keyEvents: 0, rate: 0 });
    expect(searchSums([], period)).toEqual({ clicks: 0, impressions: 0, position: 0 });
  });

  it("fills missing days of a daily line with zero", () => {
    expect(dailyPoints([{ day: "2026-11-11", sessions: 7 }], period, (item) => item.sessions)).toEqual([
      { day: "2026-11-10", value: 0 },
      { day: "2026-11-11", value: 7 },
      { day: "2026-11-12", value: 0 },
    ]);
  });
});

describe("channels", () => {
  const periods = { current: { start: "2026-11-08", end: "2026-11-14" }, previous: { start: "2026-11-01", end: "2026-11-07" } };

  it("compares each channel with the period before and keeps the six largest", () => {
    const rows = ["Organic Search", "Direct", "Referral", "Organic Social", "Email", "Unassigned", "Display"].flatMap((channel, index) => [
      { day: "2026-11-09", channel, sessions: 70 - index * 10 },
      { day: "2026-11-02", channel, sessions: 5 },
    ]);
    rows.push({ day: "2026-11-02", channel: "Paid Search", sessions: 99 });
    rows.push({ day: "2026-10-01", channel: "Direct", sessions: 1000 });
    const lines = channelMoves(rows, periods);
    expect(lines.map((line) => line.name)).toEqual(["Organic Search", "Direct", "Referral", "Organic Social", "Email", "Unassigned"]);
    expect(lines[1]).toEqual({ name: "Direct", sessions: 60, previous: 5 });
  });
});

describe("articles", () => {
  it("merges the Chinese and English pages of one article and ranks the rise and the fall", () => {
    const rows = [
      row("https://www.moviatech.ai/zh/blog/fsd-quick-start", 300, 100, 4),
      row("https://www.moviatech.ai/en/blog/fsd-quick-start/", 50, 150, 2),
      row("https://www.moviatech.ai/en/blog/fsd-quick-start#faq", 10, 0, 1),
      row("https://www.moviatech.ai/en/blog/highway-395", 20, 120),
      row("https://www.moviatech.ai/zh/blog/la-airport", 90, 10, 3),
      row("https://www.moviatech.ai/zh/blog/tag/fsd", 999, 0),
      row("https://www.moviatech.ai/zh", 999, 0),
      row("https://www.moviatech.ai/zh/blog/zz-mkt-check", 500, 0),
    ];
    const moves = articleMoves(rows);
    expect(moves.rising).toEqual([
      { slug: "fsd-quick-start", impressions: 360, previous: 250, delta: 110, clicks: 7 },
      { slug: "la-airport", impressions: 90, previous: 10, delta: 80, clicks: 3 },
    ]);
    expect(moves.falling).toEqual([{ slug: "highway-395", impressions: 20, previous: 120, delta: -100, clicks: 0 }]);
  });

  it("keeps at most five each way", () => {
    const rows = Array.from({ length: 8 }, (_, index) => row(`/zh/blog/up-${index}`, 10 + index, 0)).concat(Array.from({ length: 8 }, (_, index) => row(`/en/blog/down-${index}`, 0, 10 + index)));
    const moves = articleMoves(rows);
    expect(moves.rising.map((move) => move.slug)).toEqual(["up-7", "up-6", "up-5", "up-4", "up-3"]);
    expect(moves.falling.map((move) => move.slug)).toEqual(["down-7", "down-6", "down-5", "down-4", "down-3"]);
  });

  it("counts published, draft and scheduled articles and leaves test articles out", () => {
    const now = new Date("2026-11-24T12:00:00Z");
    expect(
      articleCounts(
        [
          { slug: "a", status: "PUBLISHED", publishAt: "2026-11-01T00:00:00Z" },
          { slug: "b", status: "PUBLISHED", publishAt: "2026-11-30T00:00:00Z" },
          { slug: "c", status: "DRAFT", publishAt: null },
          { slug: "zz-mkt-check", status: "DRAFT", publishAt: null },
        ],
        now,
      ),
    ).toEqual({ published: 1, drafts: 1, scheduled: 1 });
  });
});

describe("new search terms", () => {
  it("lists words seen now and not before, largest first, ten at most", () => {
    const rows = [row("old", 500, 20), row("gone", 0, 30), ...Array.from({ length: 12 }, (_, index) => row(`new ${index}`, 100 - index, 0, index))];
    const fresh = freshQueries(rows);
    expect(fresh).toHaveLength(10);
    expect(fresh[0]).toEqual({ query: "new 0", clicks: 0, impressions: 100, position: 5 });
    expect(fresh.some((line) => line.query === "old" || line.query === "gone")).toBe(false);
  });

  it("is empty without data", () => {
    expect(freshQueries([])).toEqual([]);
    expect(articleMoves([])).toEqual({ rising: [], falling: [] });
  });
});

describe("index summary", () => {
  it("counts indexed pages and lists the rest, failed checks first", () => {
    const summary = indexSummary([
      { slug: "a", zh: { verdict: "PASS", error: null }, en: { verdict: "NEUTRAL", error: null } },
      { slug: "b", zh: null, en: { verdict: null, error: "timeout" } },
      { slug: "c", zh: { verdict: "FAIL", error: null }, en: { verdict: "PASS", error: null } },
      { slug: "zz-mkt-check", zh: null, en: null },
    ]);
    expect(summary).toEqual({
      indexed: 2,
      total: 6,
      problems: [
        { slug: "b", language: "en", state: "error", verdict: null },
        { slug: "a", language: "en", state: "missing", verdict: "NEUTRAL" },
        { slug: "c", language: "zh", state: "missing", verdict: "FAIL" },
        { slug: "b", language: "zh", state: "none", verdict: null },
      ],
    });
  });
});

describe("booking button placements", () => {
  it("drops empty and not-set rows, ranks by clicks and gives each its share", () => {
    expect(
      placementLines([
        { name: "vehicle-detail", count: 25 },
        { name: "navbar", count: 40 },
        { name: "(not set)", count: 9 },
        { name: "", count: 3 },
        { name: "cinematic", count: 15 },
        { name: "card", count: 0 },
      ]),
    ).toEqual([
      { name: "navbar", count: 40, share: 0.5 },
      { name: "vehicle-detail", count: 25, share: 0.3125 },
      { name: "cinematic", count: 15, share: 0.1875 },
    ]);
  });

  it("is empty when every click predates the dimension", () => {
    expect(placementLines([{ name: "(not set)", count: 24 }])).toEqual([]);
    expect(placementLines([])).toEqual([]);
  });
});

describe("sync health", () => {
  const now = new Date("2026-11-24T20:00:00Z");

  it("is calm after a recent good run", () => {
    expect(syncHealth([{ startedAt: "2026-11-24T11:17:00Z", finishedAt: "2026-11-24T11:17:10Z", ok: true }], now)).toEqual({ at: "2026-11-24T11:17:10Z", failed: false, warn: false });
  });

  it("warns when the last run failed or no good run in 36 hours", () => {
    expect(syncHealth([{ startedAt: "2026-11-24T11:17:00Z", finishedAt: "2026-11-24T11:17:10Z", ok: false }, { startedAt: "2026-11-23T11:17:00Z", finishedAt: "2026-11-23T11:17:10Z", ok: true }], now)).toEqual({ at: "2026-11-24T11:17:10Z", failed: true, warn: true });
    expect(syncHealth([{ startedAt: "2026-11-23T07:00:00Z", finishedAt: "2026-11-23T07:00:10Z", ok: true }], now).warn).toBe(true);
    expect(syncHealth([], now)).toEqual({ at: null, failed: false, warn: true });
  });

  it("ignores a run that is still going", () => {
    expect(syncHealth([{ startedAt: "2026-11-24T19:59:00Z", finishedAt: null, ok: null }, { startedAt: "2026-11-24T11:17:00Z", finishedAt: "2026-11-24T11:17:10Z", ok: true }], now).at).toBe("2026-11-24T11:17:10Z");
  });
});

describe("signed counts", () => {
  it("writes a sign in front of changes", () => {
    expect([signedCount(12), signedCount(-1200, (value) => value.toLocaleString("en-US")), signedCount(0)]).toEqual(["+12", "−1,200", "0"]);
  });
});

describe("label lookup", () => {
  it("only reads a map's own keys, so names like constructor stay plain text", () => {
    const names = { navbar: "导航栏" };
    expect(["navbar", "constructor", "__proto__", "toString", "hasOwnProperty", "card"].map((key) => named(names, key) ?? key)).toEqual(["导航栏", "constructor", "__proto__", "toString", "hasOwnProperty", "card"]);
  });
});
