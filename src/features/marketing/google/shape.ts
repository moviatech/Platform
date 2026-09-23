import { compactDay } from "../dates";

export type GaFilter =
  | { kind: "in"; field: string; values: string[] }
  | { kind: "contains"; field: string; value: string }
  | { kind: "begins"; field: string; value: string }
  | { kind: "all"; parts: GaFilter[] };

export type GaRequest = {
  ranges: Array<{ start: string; end: string }>;
  dimensions?: string[];
  metrics: string[];
  limit?: number;
  orderBy?: { metric?: string; dimension?: string; descending?: boolean };
  filter?: GaFilter;
  keepEmptyRows?: boolean;
};

export type GaRow = { dims: Record<string, string>; metrics: Record<string, number>; range: number };

export type GscRow = { keys: string[]; clicks: number; impressions: number; ctr: number; position: number };

export type GscFilter = { dimension: "page" | "query" | "country" | "device"; operator: "contains" | "equals" | "notContains" | "includingRegex"; expression: string };

export type GscRequest = {
  start: string;
  end: string;
  dimensions: Array<"date" | "query" | "page" | "country" | "device">;
  rowLimit?: number;
  startRow?: number;
  filters?: GscFilter[];
};

function filterBody(filter: GaFilter): Record<string, unknown> {
  if (filter.kind === "all") return { andGroup: { expressions: filter.parts.map(filterBody) } };
  if (filter.kind === "in") return { filter: { fieldName: filter.field, inListFilter: { values: filter.values } } };
  return { filter: { fieldName: filter.field, stringFilter: { matchType: filter.kind === "contains" ? "CONTAINS" : "BEGINS_WITH", value: filter.value } } };
}

export function gaBody(request: GaRequest): Record<string, unknown> {
  const order = request.orderBy;
  return {
    dateRanges: request.ranges.map((range) => ({ startDate: range.start, endDate: range.end })),
    dimensions: (request.dimensions ?? []).map((name) => ({ name })),
    metrics: request.metrics.map((name) => ({ name })),
    ...(request.limit ? { limit: String(request.limit) } : {}),
    ...(order ? { orderBys: [{ ...(order.metric ? { metric: { metricName: order.metric } } : { dimension: { dimensionName: order.dimension ?? "" } }), desc: Boolean(order.descending) }] } : {}),
    ...(request.filter ? { dimensionFilter: filterBody(request.filter) } : {}),
    ...(request.keepEmptyRows ? { keepEmptyRows: true } : {}),
  };
}

const record = (value: unknown): Record<string, unknown> => (value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {});

const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

const number = (value: unknown) => {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : 0;
};

export function gaRows(report: unknown): GaRow[] {
  const body = record(report);
  const dimensionNames = list(body.dimensionHeaders).map((header) => String(record(header).name ?? ""));
  const metricNames = list(body.metricHeaders).map((header) => String(record(header).name ?? ""));
  return list(body.rows).map((raw) => {
    const row = record(raw);
    const dims: Record<string, string> = {};
    let range = 0;
    list(row.dimensionValues).forEach((cell, index) => {
      const name = dimensionNames[index] ?? "";
      const value = String(record(cell).value ?? "");
      if (name === "dateRange") range = Number(value.replace("date_range_", "")) || 0;
      else dims[name] = name === "date" ? compactDay(value) : value;
    });
    const metrics: Record<string, number> = {};
    list(row.metricValues).forEach((cell, index) => {
      metrics[metricNames[index] ?? ""] = number(record(cell).value);
    });
    return { dims, metrics, range };
  });
}

export function gscBody(request: GscRequest): Record<string, unknown> {
  return {
    startDate: request.start,
    endDate: request.end,
    dimensions: request.dimensions,
    type: "web",
    dataState: "final",
    rowLimit: Math.min(25000, Math.max(1, request.rowLimit ?? 1000)),
    ...(request.startRow ? { startRow: request.startRow } : {}),
    ...(request.filters?.length ? { dimensionFilterGroups: [{ groupType: "and", filters: request.filters }] } : {}),
  };
}

export function gscRows(response: unknown): GscRow[] {
  return list(record(response).rows).map((raw) => {
    const row = record(raw);
    return { keys: list(row.keys).map(String), clicks: number(row.clicks), impressions: number(row.impressions), ctr: number(row.ctr), position: number(row.position) };
  });
}

export type Sitemap = { path: string; lastSubmitted: string | null; lastDownloaded: string | null; pending: boolean; errors: number; warnings: number; submitted: number; indexed: number | null };

export function sitemaps(response: unknown): Sitemap[] {
  return list(record(response).sitemap).map((raw) => {
    const item = record(raw);
    const contents = list(item.contents).map(record);
    const stamp = (value: unknown) => (typeof value === "string" && !Number.isNaN(Date.parse(value)) ? value : null);
    const indexed = contents.filter((entry) => entry.indexed !== undefined);
    return {
      path: String(item.path ?? ""),
      lastSubmitted: stamp(item.lastSubmitted),
      lastDownloaded: stamp(item.lastDownloaded),
      pending: Boolean(item.isPending),
      errors: number(item.errors),
      warnings: number(item.warnings),
      submitted: contents.reduce((sum, entry) => sum + number(entry.submitted), 0),
      indexed: indexed.length ? indexed.reduce((sum, entry) => sum + number(entry.indexed), 0) : null,
    };
  });
}

export type Inspection = { verdict: string; coverage: string; indexing: string; fetchState: string; robots: string; canonical: string; lastCrawl: string | null };

export function inspection(response: unknown): Inspection {
  const status = record(record(record(response).inspectionResult).indexStatusResult);
  const crawl = typeof status.lastCrawlTime === "string" && !Number.isNaN(Date.parse(status.lastCrawlTime)) ? status.lastCrawlTime : null;
  const text = (value: unknown) => (typeof value === "string" ? value.slice(0, 300) : "");
  return { verdict: text(status.verdict), coverage: text(status.coverageState), indexing: text(status.indexingState), fetchState: text(status.pageFetchState), robots: text(status.robotsTxtState), canonical: text(status.googleCanonical), lastCrawl: crawl };
}

export function googleMessage(body: unknown, status: number) {
  const error = record(record(body).error);
  const message = typeof error.message === "string" ? error.message : typeof record(body).error_description === "string" ? String(record(body).error_description) : "";
  return `${status}${message ? ` ${message.replace(/\s+/g, " ").slice(0, 300)}` : ""}`;
}
