import { createVerify, generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { articleOf, funnelSteps, gaSeries, languageShares, lastSearchDay, opportunities, searchLines, searchPeriod, searchSeries, searchTotals, topPerDay } from "./analysis";
import { addDays, compactDay, daysApart, isDay, listDays, parseRange, periodsEnding, within, zoneDay } from "./dates";
import { change, decimal, duration, exact, niceTop, percent, shortDay, signed, whole } from "./figures";
import { regionCodes, regionName } from "./regions";
import { googleScopes, parseServiceAccount, signAssertion } from "./google/jwt";
import { gaBody, gaRows, googleMessage, gscBody, gscRows, inspection, sitemaps, type GaRow, type GscRow } from "./google/shape";

describe("dates", () => {
  it("accepts the three ranges and falls back to four weeks", () => {
    expect([parseRange("7"), parseRange(28), parseRange(["90"]), parseRange("30"), parseRange(undefined), parseRange("abc")]).toEqual([7, 28, 90, 28, 28, 28]);
  });

  it("uses the Pacific calendar day", () => {
    expect(zoneDay(new Date("2026-11-24T07:59:00Z"))).toBe("2026-11-23");
    expect(zoneDay(new Date("2026-11-24T08:01:00Z"))).toBe("2026-11-24");
    expect(zoneDay(new Date("2026-07-01T06:59:00Z"))).toBe("2026-06-30");
  });

  it("does plain calendar arithmetic across months, years and clock changes", () => {
    expect(addDays("2026-11-01", -1)).toBe("2026-10-31");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-08", 1)).toBe("2026-03-09");
    expect(daysApart("2026-10-30", "2026-11-02")).toBe(3);
    expect(listDays("2026-02-27", "2026-03-02")).toEqual(["2026-02-27", "2026-02-28", "2026-03-01", "2026-03-02"]);
    expect(listDays("2026-03-02", "2026-03-01")).toEqual([]);
  });

  it("builds a period and the equally long one before it", () => {
    expect(periodsEnding("2026-11-20", 7)).toEqual({ current: { start: "2026-11-14", end: "2026-11-20" }, previous: { start: "2026-11-07", end: "2026-11-13" } });
    const month = periodsEnding("2026-11-20", 28);
    expect(daysApart(month.current.start, month.current.end)).toBe(27);
    expect(daysApart(month.previous.start, month.previous.end)).toBe(27);
    expect(addDays(month.previous.end, 1)).toBe(month.current.start);
    expect([within("2026-11-14", month.current), within("2026-10-23", month.current)]).toEqual([true, false]);
  });

  it("knows a real day from a made-up one and reads Google's compact dates", () => {
    expect([isDay("2026-02-28"), isDay("2026-02-30"), isDay("2026-2-3"), isDay("")]).toEqual([true, false, false, false]);
    expect([compactDay("20261123"), compactDay("2026-11-23"), compactDay("(other)")]).toEqual(["2026-11-23", "2026-11-23", "(other)"]);
  });
});

describe("figures", () => {
  it("writes counts in full under ten thousand and compact above", () => {
    expect([whole(0, "en"), whole(1284, "en"), whole(9999.4, "en"), whole(12940, "en"), whole(4200000, "en")]).toEqual(["0", "1,284", "9,999", "12.9K", "4.2M"]);
    expect([whole(1284, "zh"), whole(12940, "zh")]).toEqual(["1,284", "1.3万"]);
    expect(exact(12940, "en")).toBe("12,940");
  });

  it("writes rates, positions and time spent", () => {
    expect([percent(0.1234), percent(0), percent(1), percent(Number.NaN)]).toEqual(["12.3%", "0.0%", "100.0%", "—"]);
    expect([decimal(8.24), decimal(12)]).toEqual(["8.2", "12.0"]);
    expect([duration(83, "zh"), duration(45, "zh"), duration(83, "en"), duration(0, "en"), duration(Number.NaN, "en")]).toEqual(["1 分 23 秒", "45 秒", "1m 23s", "0s", "0s"]);
  });

  it("compares with the period before", () => {
    expect(change(120, 100)).toEqual({ ratio: 0.2, direction: "up" });
    expect(change(80, 100)).toEqual({ ratio: -0.2, direction: "down" });
    expect(change(100, 100)).toEqual({ ratio: 0, direction: "flat" });
    expect(change(5, 0)).toEqual({ ratio: null, direction: "up" });
    expect(change(0, 0)).toEqual({ ratio: null, direction: "flat" });
    expect([signed(0.2), signed(-0.126), signed(1.5), signed(0), signed(null)]).toEqual(["+20.0%", "−12.6%", "+150%", "0.0%", ""]);
  });

  it("labels days and picks a clean top for an axis", () => {
    expect([shortDay("2026-11-03", "zh"), shortDay("2026-11-03", "en")]).toEqual(["11月3日", "Nov 3"]);
    expect([niceTop(0), niceTop(3), niceTop(7), niceTop(43), niceTop(260), niceTop(1000), niceTop(1001)]).toEqual([4, 4, 8, 50, 400, 1000, 2000]);
  });
});

describe("the service account", () => {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const file = JSON.stringify({ type: "service_account", client_email: "reader@demo-project.iam.gserviceaccount.com", private_key: pem, token_uri: "https://elsewhere.example/token" });

  it("reads the key file as it is or in base64", () => {
    const direct = parseServiceAccount(file);
    const packed = parseServiceAccount(Buffer.from(file).toString("base64"));
    const wrapped = parseServiceAccount(`  ${Buffer.from(file).toString("base64").replace(/(.{76})/g, "$1\n")}  `);
    expect(direct?.clientEmail).toBe("reader@demo-project.iam.gserviceaccount.com");
    expect(direct?.privateKey).toBe(pem);
    expect(packed).toEqual(direct);
    expect(wrapped).toEqual(direct);
  });

  it("restores line breaks that an environment file flattened", () => {
    const flattened = JSON.stringify({ client_email: "reader@demo-project.iam.gserviceaccount.com", private_key: pem.replace(/\n/g, "\\n") });
    expect(parseServiceAccount(flattened)?.privateKey).toBe(pem);
  });

  it("refuses anything that is not a key file", () => {
    for (const bad of ["", "   ", "not json", "{}", JSON.stringify({ client_email: "x", private_key: pem }), JSON.stringify({ client_email: "a@b.co", private_key: "nope" }), Buffer.from("[1,2]").toString("base64"), null, undefined]) expect(parseServiceAccount(bad), String(bad)).toBeNull();
  });

  it("signs a request for a read-only token that Google can verify", () => {
    const account = parseServiceAccount(file);
    expect(account).not.toBeNull();
    if (!account) return;
    const assertion = signAssertion(account, "https://oauth2.googleapis.com/token", 1795000000);
    const [header, claims, signature] = assertion.split(".");
    expect(JSON.parse(Buffer.from(header, "base64url").toString())).toEqual({ alg: "RS256", typ: "JWT" });
    expect(JSON.parse(Buffer.from(claims, "base64url").toString())).toEqual({ iss: "reader@demo-project.iam.gserviceaccount.com", scope: googleScopes, aud: "https://oauth2.googleapis.com/token", iat: 1795000000, exp: 1795003600 });
    expect(createVerify("RSA-SHA256").update(`${header}.${claims}`).verify(publicKey, Buffer.from(signature, "base64url"))).toBe(true);
    expect(googleScopes.split(" ").every((scope) => scope.endsWith(".readonly"))).toBe(true);
  });
});

describe("Analytics requests and answers", () => {
  it("writes the request the Data API expects", () => {
    expect(gaBody({ ranges: [{ start: "2026-10-24", end: "2026-11-20" }, { start: "2026-09-26", end: "2026-10-23" }], metrics: ["activeUsers", "sessions"] })).toEqual({
      dateRanges: [
        { startDate: "2026-10-24", endDate: "2026-11-20" },
        { startDate: "2026-09-26", endDate: "2026-10-23" },
      ],
      dimensions: [],
      metrics: [{ name: "activeUsers" }, { name: "sessions" }],
    });
    expect(gaBody({ ranges: [{ start: "2026-11-14", end: "2026-11-20" }], dimensions: ["landingPage"], metrics: ["sessions"], limit: 20, orderBy: { metric: "sessions", descending: true }, filter: { kind: "all", parts: [{ kind: "contains", field: "landingPage", value: "/blog/" }, { kind: "in", field: "eventName", values: ["a", "b"] }, { kind: "begins", field: "pagePath", value: "/zh" }] }, keepEmptyRows: true })).toEqual({
      dateRanges: [{ startDate: "2026-11-14", endDate: "2026-11-20" }],
      dimensions: [{ name: "landingPage" }],
      metrics: [{ name: "sessions" }],
      limit: "20",
      orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
      dimensionFilter: { andGroup: { expressions: [{ filter: { fieldName: "landingPage", stringFilter: { matchType: "CONTAINS", value: "/blog/" } } }, { filter: { fieldName: "eventName", inListFilter: { values: ["a", "b"] } } }, { filter: { fieldName: "pagePath", stringFilter: { matchType: "BEGINS_WITH", value: "/zh" } } }] } },
      keepEmptyRows: true,
    });
    expect(gaBody({ ranges: [{ start: "2026-11-14", end: "2026-11-20" }], dimensions: ["date"], metrics: ["sessions"], orderBy: { dimension: "date" } }).orderBys).toEqual([{ dimension: { dimensionName: "date" }, desc: false }]);
  });

  it("reads rows, dates and the period each row belongs to", () => {
    const rows = gaRows({
      dimensionHeaders: [{ name: "date" }, { name: "dateRange" }],
      metricHeaders: [{ name: "sessions", type: "TYPE_INTEGER" }, { name: "engagementRate", type: "TYPE_FLOAT" }],
      rows: [
        { dimensionValues: [{ value: "20261120" }, { value: "date_range_0" }], metricValues: [{ value: "41" }, { value: "0.6341" }] },
        { dimensionValues: [{ value: "20261023" }, { value: "date_range_1" }], metricValues: [{ value: "12" }, { value: "" }] },
      ],
    });
    expect(rows).toEqual([
      { dims: { date: "2026-11-20" }, metrics: { sessions: 41, engagementRate: 0.6341 }, range: 0 },
      { dims: { date: "2026-10-23" }, metrics: { sessions: 12, engagementRate: 0 }, range: 1 },
    ]);
    expect(gaRows({})).toEqual([]);
    expect(gaRows(null)).toEqual([]);
    expect(gaRows({ rows: "nope" })).toEqual([]);
  });
});

describe("Search Console requests and answers", () => {
  it("writes the query with final data only and the page filters", () => {
    expect(gscBody({ start: "2026-10-24", end: "2026-11-20", dimensions: ["query"], rowLimit: 500, filters: [{ dimension: "page", operator: "contains", expression: "/blog/" }] })).toEqual({
      startDate: "2026-10-24",
      endDate: "2026-11-20",
      dimensions: ["query"],
      type: "web",
      dataState: "final",
      rowLimit: 500,
      dimensionFilterGroups: [{ groupType: "and", filters: [{ dimension: "page", operator: "contains", expression: "/blog/" }] }],
    });
    expect(gscBody({ start: "2026-11-01", end: "2026-11-02", dimensions: ["date"], rowLimit: 90000, startRow: 25000 })).toMatchObject({ rowLimit: 25000, startRow: 25000 });
    expect(gscBody({ start: "2026-11-01", end: "2026-11-02", dimensions: [] })).not.toHaveProperty("dimensionFilterGroups");
  });

  it("reads rows, sitemaps and an index check", () => {
    expect(gscRows({ rows: [{ keys: ["rent a tesla irvine"], clicks: 3, impressions: 120, ctr: 0.025, position: 8.4 }, { keys: [], clicks: "x" }] })).toEqual([
      { keys: ["rent a tesla irvine"], clicks: 3, impressions: 120, ctr: 0.025, position: 8.4 },
      { keys: [], clicks: 0, impressions: 0, ctr: 0, position: 0 },
    ]);
    expect(gscRows({})).toEqual([]);
    expect(sitemaps({ sitemap: [{ path: "https://www.moviatech.ai/sitemap.xml", lastSubmitted: "2026-11-01T10:00:00.000Z", lastDownloaded: "2026-11-22T03:00:00.000Z", isPending: false, errors: "0", warnings: "2", contents: [{ type: "web", submitted: "140", indexed: "0" }] }, { path: "https://x/y.xml", lastSubmitted: "soon" }] })).toEqual([
      { path: "https://www.moviatech.ai/sitemap.xml", lastSubmitted: "2026-11-01T10:00:00.000Z", lastDownloaded: "2026-11-22T03:00:00.000Z", pending: false, errors: 0, warnings: 2, submitted: 140, indexed: 0 },
      { path: "https://x/y.xml", lastSubmitted: null, lastDownloaded: null, pending: false, errors: 0, warnings: 0, submitted: 0, indexed: null },
    ]);
    expect(inspection({ inspectionResult: { indexStatusResult: { verdict: "PASS", coverageState: "Submitted and indexed", indexingState: "INDEXING_ALLOWED", pageFetchState: "SUCCESSFUL", robotsTxtState: "ALLOWED", googleCanonical: "https://www.moviatech.ai/en/blog/x", lastCrawlTime: "2026-11-20T09:12:00Z" } } })).toEqual({ verdict: "PASS", coverage: "Submitted and indexed", indexing: "INDEXING_ALLOWED", fetchState: "SUCCESSFUL", robots: "ALLOWED", canonical: "https://www.moviatech.ai/en/blog/x", lastCrawl: "2026-11-20T09:12:00Z" });
    expect(inspection({})).toEqual({ verdict: "", coverage: "", indexing: "", fetchState: "", robots: "", canonical: "", lastCrawl: null });
  });

  it("keeps Google's own words when a call fails, without anything else", () => {
    expect(googleMessage({ error: { code: 403, message: "User does not have sufficient permission for site 'sc-domain:moviatech.ai'." } }, 403)).toBe("403 User does not have sufficient permission for site 'sc-domain:moviatech.ai'.");
    expect(googleMessage({ error: "invalid_grant", error_description: "Invalid JWT Signature." }, 400)).toBe("400 Invalid JWT Signature.");
    expect(googleMessage("<html>", 502)).toBe("502");
    expect(googleMessage({ error: { message: "x".repeat(900) } }, 500).length).toBe(304);
  });
});

describe("what the pages show", () => {
  const day = (date: string, clicks: number, impressions: number, position: number): GscRow => ({ keys: [date], clicks, impressions, ctr: impressions ? clicks / impressions : 0, position });

  it("adds up search results and weights the position by impressions", () => {
    expect(searchTotals([{ clicks: 2, impressions: 100, position: 4 }, { clicks: 1, impressions: 300, position: 12 }])).toEqual({ clicks: 3, impressions: 400, ctr: 0.0075, position: 10 });
    expect(searchTotals([])).toEqual({ clicks: 0, impressions: 0, ctr: 0, position: 0 });
  });

  it("finds the last day Google has reported and fills quiet days with zero", () => {
    const rows = [day("2026-11-17", 1, 40, 9), day("2026-11-19", 2, 60, 7), day("2026-11-20", 0, 0, 0)];
    expect(lastSearchDay(rows)).toBe("2026-11-19");
    expect(lastSearchDay([])).toBeNull();
    const period = { start: "2026-11-17", end: "2026-11-19" };
    expect(searchSeries(rows, period, (row) => row.clicks)).toEqual([{ day: "2026-11-17", value: 1 }, { day: "2026-11-18", value: 0 }, { day: "2026-11-19", value: 2 }]);
    expect(searchPeriod(rows, period)).toEqual({ clicks: 3, impressions: 100, ctr: 0.03, position: 7.8 });
  });

  it("ranks by clicks and picks out words that rank just off the top", () => {
    const rows: GscRow[] = [
      { keys: ["tesla rental irvine"], clicks: 9, impressions: 200, ctr: 0.045, position: 3.2 },
      { keys: ["rent tesla lax"], clicks: 1, impressions: 900, ctr: 0.0011, position: 11.4 },
      { keys: ["fsd rental"], clicks: 0, impressions: 320, ctr: 0, position: 6.8 },
      { keys: ["cybertruck rental"], clicks: 0, impressions: 5, ctr: 0, position: 8 },
      { keys: ["movia"], clicks: 4, impressions: 40, ctr: 0.1, position: 5 },
      { keys: ["tesla charging guide"], clicks: 0, impressions: 500, ctr: 0, position: 34 },
      { keys: [""], clicks: 50, impressions: 50, ctr: 1, position: 1 },
    ];
    const lines = searchLines(rows, 10);
    expect(lines.map((line) => line.key)).toEqual(["tesla rental irvine", "movia", "rent tesla lax", "tesla charging guide", "fsd rental", "cybertruck rental"]);
    expect(opportunities(lines).map((line) => line.key)).toEqual(["rent tesla lax", "fsd rental"]);
    expect(searchLines(rows, 2)).toHaveLength(2);
  });

  it("splits landing pages by language", () => {
    const row = (landingPage: string, sessions: number, engagedSessions: number, keyEvents: number): GaRow => ({ dims: { landingPage }, metrics: { sessions, engagedSessions, keyEvents }, range: 0 });
    expect(languageShares([row("/zh", 40, 22, 1), row("/zh/blog/fsd-quick-start", 10, 8, 0), row("/en/vehicles?x=1", 30, 12, 2), row("/english-test", 3, 1, 0), row("(not set)", 2, 0, 0), row("/en", 5, 5, 0)])).toEqual([
      { key: "zh", sessions: 50, engaged: 30, keyEvents: 1 },
      { key: "en", sessions: 35, engaged: 17, keyEvents: 2 },
      { key: "other", sessions: 5, engaged: 1, keyEvents: 0 },
    ]);
  });

  it("lays out the booking steps with the share that went on from each one", () => {
    const row = (eventName: string, activeUsers: number): GaRow => ({ dims: { eventName }, metrics: { activeUsers }, range: 0 });
    expect(funnelSteps([row("book_cta_click", 40), row("vehicle_view", 200), row("booking_request_success", 3)], ["vehicle_view", "book_cta_click", "booking_request_submit", "booking_request_success"])).toEqual([
      { event: "vehicle_view", users: 200, share: null },
      { event: "book_cta_click", users: 40, share: 0.2 },
      { event: "booking_request_submit", users: 0, share: 0 },
      { event: "booking_request_success", users: 3, share: null },
    ]);
  });

  it("fills a daily line for Analytics and keeps the busiest rows of each day", () => {
    const rows: GaRow[] = [{ dims: { date: "2026-11-18" }, metrics: { sessions: 12 }, range: 0 }, { dims: { date: "2026-11-20" }, metrics: { sessions: 7 }, range: 0 }];
    expect(gaSeries(rows, { start: "2026-11-18", end: "2026-11-20" }, "sessions")).toEqual([{ day: "2026-11-18", value: 12 }, { day: "2026-11-19", value: 0 }, { day: "2026-11-20", value: 7 }]);
    const many = [
      { day: "2026-11-18", key: "a", clicks: 1, impressions: 10 },
      { day: "2026-11-18", key: "b", clicks: 5, impressions: 10 },
      { day: "2026-11-18", key: "c", clicks: 1, impressions: 90 },
      { day: "2026-11-19", key: "d", clicks: 0, impressions: 1 },
    ];
    expect(topPerDay(many, 2).map((row) => row.key)).toEqual(["b", "c", "d"]);
  });

  it("recognises a blog article address in either language", () => {
    expect(articleOf("/zh/blog/fsd-quick-start")).toBe("fsd-quick-start");
    expect(articleOf("https://www.moviatech.ai/en/blog/tesla-fsd-v15-new-features-rental-guide/")).toBe("tesla-fsd-v15-new-features-rental-guide");
    expect(articleOf("https://www.moviatech.ai/en/blog/fsd-quick-start?utm_source=x")).toBe("fsd-quick-start");
    for (const other of ["/zh/blog", "/en/blog/tag/fsd", "/en/vehicles", "/blog/fsd-quick-start", "/zh/blog/preview/abc", "(not set)"]) expect(articleOf(other), other).toBeNull();
  });
});

describe("region names", () => {
  it("covers every country code once", () => {
    expect(regionCodes.size).toBe(250);
    expect(new Set(regionCodes.values()).size).toBe(250);
    const names = new Intl.DisplayNames(["en"], { type: "region" });
    for (const [long, short] of regionCodes) {
      expect(long).toMatch(/^[a-z]{3}$/);
      expect(short).toMatch(/^[A-Z]{2}$/);
      expect(names.of(short)).not.toBe(short);
    }
  });

  it("reads both code styles", () => {
    expect(regionName("usa", "en")).toBe("United States");
    expect(regionName("US", "en")).toBe("United States");
    expect(regionName("chn", "zh")).toBe("中国");
    expect(regionName("twn", "en")).toBe("Taiwan");
    expect(regionName("zzz", "en")).toBe("—");
    expect(regionName("", "zh")).toBe("—");
    expect(regionName("(not set)", "zh")).toBe("—");
    expect(regionName("abc", "en")).toBe("ABC");
  });
});
