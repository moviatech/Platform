import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { topPerDay } from "./analysis";
import { addDays, zoneDay } from "./dates";
import { googleFailure, runReports, searchEverything, searchQuery } from "./google/client";
import { googleSettings } from "./google/config";
import type { GscRow } from "./google/shape";
import { checkOldest } from "./indexing";

type Admin = ReturnType<typeof createAdminClient>;

type Step = { ok: boolean; rows?: number; from?: string; to?: string; error?: string };

export type SyncSummary = { configured: { analytics: boolean; search: boolean }; steps: Record<string, Step>; took: number };

const recentDays = 12;

const historyDays = 480;

const chunkDays = 45;

const perDay = 500;

const budgetMs = 20000;

async function writeRows(supabase: Admin, table: string, rows: Array<Record<string, unknown>>, onConflict: string) {
  for (let at = 0; at < rows.length; at += 500) {
    const { error } = await supabase.from(table).upsert(rows.slice(at, at + 500), { onConflict });
    if (error) throw new Error(`${table}: ${error.message}`);
  }
}

async function readState<Value>(supabase: Admin, key: string): Promise<Value | null> {
  const { data } = await supabase.from("marketing_sync_state").select("value").eq("key", key).maybeSingle();
  return (data?.value as Value | undefined) ?? null;
}

async function writeState(supabase: Admin, key: string, value: unknown) {
  await supabase.from("marketing_sync_state").upsert({ key, value, updated_at: new Date().toISOString() });
}

async function analytics(supabase: Admin, property: string, start: string, end: string) {
  const range = [{ start, end }];
  const [daily, channels] = await runReports([
    { ranges: range, dimensions: ["date"], metrics: ["activeUsers", "newUsers", "sessions", "engagedSessions", "userEngagementDuration", "screenPageViews", "keyEvents"], orderBy: { dimension: "date" }, limit: 1000 },
    { ranges: range, dimensions: ["date", "sessionDefaultChannelGroup"], metrics: ["activeUsers", "sessions", "engagedSessions", "keyEvents"], orderBy: { dimension: "date" }, limit: 20000 },
  ]);
  const stamp = new Date().toISOString();
  const days = daily
    .filter((row) => /^\d{4}-\d{2}-\d{2}$/.test(row.dims.date ?? ""))
    .map((row) => ({ property, day: row.dims.date, users: Math.round(row.metrics.activeUsers ?? 0), new_users: Math.round(row.metrics.newUsers ?? 0), sessions: Math.round(row.metrics.sessions ?? 0), engaged_sessions: Math.round(row.metrics.engagedSessions ?? 0), engagement_seconds: row.metrics.userEngagementDuration ?? 0, views: Math.round(row.metrics.screenPageViews ?? 0), key_events: row.metrics.keyEvents ?? 0, updated_at: stamp }));
  const byChannel = channels
    .filter((row) => /^\d{4}-\d{2}-\d{2}$/.test(row.dims.date ?? ""))
    .map((row) => ({ property, day: row.dims.date, channel: (row.dims.sessionDefaultChannelGroup || "(not set)").slice(0, 120), users: Math.round(row.metrics.activeUsers ?? 0), sessions: Math.round(row.metrics.sessions ?? 0), engaged_sessions: Math.round(row.metrics.engagedSessions ?? 0), key_events: row.metrics.keyEvents ?? 0 }));
  await writeRows(supabase, "marketing_ga_daily", days, "property,day");
  await writeRows(supabase, "marketing_ga_channel_daily", byChannel, "property,day,channel");
  return days.length + byChannel.length;
}

function keyed(rows: GscRow[], site: string, column: "page" | "query") {
  const merged = new Map<string, { site: string; day: string; clicks: number; impressions: number; weighted: number; name: string }>();
  for (const row of rows) {
    const day = row.keys[0] ?? "";
    const name = (row.keys[1] ?? "").slice(0, 400);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !name) continue;
    const id = `${day}\n${name}`;
    const entry = merged.get(id) ?? { site, day, clicks: 0, impressions: 0, weighted: 0, name };
    entry.clicks += row.clicks;
    entry.impressions += row.impressions;
    entry.weighted += row.position * row.impressions;
    merged.set(id, entry);
  }
  return topPerDay([...merged.values()], perDay).map((entry) => ({ site, day: entry.day, [column]: entry.name, clicks: Math.round(entry.clicks), impressions: Math.round(entry.impressions), position: entry.impressions ? entry.weighted / entry.impressions : 0 }));
}

async function searchWindow(supabase: Admin, site: string, start: string, end: string) {
  const [daily, pages, queries] = await Promise.all([searchQuery({ start, end, dimensions: ["date"], rowLimit: 1000 }), searchEverything({ start, end, dimensions: ["date", "page"] }), searchEverything({ start, end, dimensions: ["date", "query"] })]);
  const stamp = new Date().toISOString();
  const days = daily.filter((row) => /^\d{4}-\d{2}-\d{2}$/.test(row.keys[0] ?? "")).map((row) => ({ site, day: row.keys[0], clicks: Math.round(row.clicks), impressions: Math.round(row.impressions), position: row.position, updated_at: stamp }));
  const pageRows = keyed(pages, site, "page");
  const queryRows = keyed(queries, site, "query");
  await writeRows(supabase, "marketing_gsc_daily", days, "site,day");
  for (const [table, rows, conflict] of [
    ["marketing_gsc_page_daily", pageRows, "site,day,page"],
    ["marketing_gsc_query_daily", queryRows, "site,day,query"],
  ] as const) {
    const { error } = await supabase.from(table).delete().eq("site", site).gte("day", start).lte("day", end);
    if (error) throw new Error(`${table}: ${error.message}`);
    await writeRows(supabase, table, rows, conflict);
  }
  return { rows: days.length + pageRows.length + queryRows.length, days: days.length };
}

export async function runGoogleSync(now = new Date()): Promise<SyncSummary> {
  const started = Date.now();
  const { account, property, site } = googleSettings();
  const configured = { analytics: Boolean(account && property), search: Boolean(account && site) };
  const steps: Record<string, Step> = {};
  const supabase = createAdminClient();
  const today = zoneDay(now);
  const yesterday = addDays(today, -1);
  const floor = addDays(today, -historyDays);
  const left = () => budgetMs - (Date.now() - started);
  const lastDay = async (table: string, column: string, value: string) => {
    const { data } = await supabase.from(table).select("day").eq(column, value).order("day", { ascending: false }).limit(1).maybeSingle();
    return (data?.day as string | undefined) ?? null;
  };
  const resume = (last: string | null) => {
    const usual = addDays(today, -recentDays);
    const from = last && addDays(last, -3) < usual ? addDays(last, -3) : usual;
    return from < floor ? floor : from;
  };
  const attempt = async (name: string, run: () => Promise<Step>) => {
    try {
      steps[name] = await run();
    } catch (cause) {
      const known = googleFailure(cause);
      const error = known === "failed" && cause instanceof Error ? cause.message.slice(0, 300) : known;
      steps[name] = { ok: false, error };
      console.error("[marketing:sync]", name, error);
    }
  };

  const scope = { property, site };
  const { data: run } = await supabase.from("marketing_sync_runs").insert({ detail: { configured, scope } }).select("id").maybeSingle();

  if (configured.analytics && property) {
    await attempt("analytics", async () => {
      const state = await readState<{ complete?: boolean }>(supabase, `ga:${property}:history`);
      const from = state?.complete ? resume(await lastDay("marketing_ga_daily", "property", property)) : floor;
      const rows = await analytics(supabase, property, from, yesterday);
      if (!state?.complete) await writeState(supabase, `ga:${property}:history`, { complete: true, from });
      return { ok: true, rows, from, to: yesterday };
    });
  }

  if (configured.search && site) {
    await attempt("search", async () => {
      const from = resume(await lastDay("marketing_gsc_daily", "site", site));
      const result = await searchWindow(supabase, site, from, yesterday);
      return { ok: true, rows: result.rows, from, to: yesterday };
    });
    await attempt("searchHistory", async () => {
      const key = `gsc:${site}:history`;
      const state = await readState<{ until?: string }>(supabase, key);
      let end = state?.until ? addDays(state.until, -1) : addDays(today, -recentDays - 1);
      let rows = 0;
      let reached = state?.until ?? addDays(today, -recentDays);
      while (end >= floor && left() > 12500) {
        const start = addDays(end, 1 - chunkDays) < floor ? floor : addDays(end, 1 - chunkDays);
        const result = await searchWindow(supabase, site, start, end);
        rows += result.rows;
        reached = start;
        await writeState(supabase, key, { until: start });
        end = addDays(start, -1);
      }
      return { ok: true, rows, from: reached, to: floor };
    });
    if (left() > 11000) {
      await attempt("indexChecks", async () => ({ ok: true, rows: await checkOldest(20, 168, 9000) }));
    }
  }

  await supabase.from("marketing_report_cache").delete().lt("fetched_at", new Date(Date.now() - 3 * 86400000).toISOString());
  await supabase.from("marketing_sync_runs").delete().lt("started_at", new Date(Date.now() - 45 * 86400000).toISOString());
  const took = Date.now() - started;
  const ok = Object.values(steps).every((step) => step.ok);
  if (run?.id) await supabase.from("marketing_sync_runs").update({ finished_at: new Date().toISOString(), ok, detail: { configured, scope, steps, took } }).eq("id", run.id);
  return { configured, steps, took };
}

export async function lastSync() {
  const { data } = await createAdminClient().from("marketing_sync_runs").select("started_at, finished_at, ok, detail").order("started_at", { ascending: false }).limit(1).maybeSingle();
  return data ? { startedAt: data.started_at as string, finishedAt: data.finished_at as string | null, ok: data.ok as boolean | null } : null;
}
