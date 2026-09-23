import "server-only";
import { cached } from "./cache";
import { addDays, periodsEnding, zoneDay, type RangeDays } from "./dates";
import { GoogleError, runReports } from "./google/client";
import { googleSettings } from "./google/config";
import { placementLines, type PlacementLine } from "./overview-math";

export type PlacementView = { state: "ok"; lines: PlacementLine[] } | { state: "missing" } | { state: "none" };

type Stored = { missing: boolean; rows: Array<{ name: string; count: number }> };

async function fetchPlacement(days: RangeDays, lastDay: string): Promise<Stored> {
  const { current } = periodsEnding(lastDay, days);
  try {
    const [rows] = await runReports([{ ranges: [current], dimensions: ["customEvent:placement"], metrics: ["eventCount"], filter: { kind: "in", field: "eventName", values: ["book_cta_click"] }, orderBy: { metric: "eventCount", descending: true }, limit: 10 }]);
    return { missing: false, rows: rows.map((row) => ({ name: row.dims["customEvent:placement"] ?? "", count: row.metrics.eventCount ?? 0 })) };
  } catch (cause) {
    if (cause instanceof GoogleError && cause.status === 400) return { missing: true, rows: [] };
    throw cause;
  }
}

const placementBudgetMs = 4000;

export async function loadPlacement(days: RangeDays, now = new Date(), budgetMs = placementBudgetMs): Promise<PlacementView> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<PlacementView>((resolve) => {
    timer = setTimeout(() => resolve({ state: "none" }), budgetMs);
  });
  try {
    return await Promise.race([readPlacement(days, now), late]);
  } finally {
    clearTimeout(timer);
  }
}

async function readPlacement(days: RangeDays, now: Date): Promise<PlacementView> {
  const { account, property } = googleSettings();
  if (!account || !property) return { state: "none" };
  const lastDay = addDays(zoneDay(now), -1);
  try {
    const { value } = await cached(`ga:${property}:placement:${days}:${lastDay}`, () => fetchPlacement(days, lastDay));
    if (value.missing) return { state: "missing" };
    const lines = placementLines(value.rows);
    return lines.length ? { state: "ok", lines } : { state: "none" };
  } catch {
    return { state: "none" };
  }
}
