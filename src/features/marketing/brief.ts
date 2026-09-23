import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { aiScope, askAi, type AiActor, type AiFailure } from "./ai";
import { addDays, isDay, zoneDay } from "./dates";
import { briefFacts, briefFlags, briefInstructions, briefPrompt, briefSchema, briefWeek, fitFacts, type BriefContent, type BriefWeek } from "./brief-math";
import { googleSettings } from "./google/config";
import { loadIndexStatus } from "./indexing";
import { indexSummary } from "./overview-math";
import { asNumber, compare, everyRow, loadArticles, type Admin } from "./overview";

export type BriefStatus = "created" | "exists" | "no_data" | AiFailure;

export type BriefResult = { status: BriefStatus; key: string | null; flags?: string[] };

export type StoredBrief = { key: string; start: string; end: string; content: BriefContent; flags: string[]; createdAt: string };

async function gather(supabase: Admin, property: string | null, site: string, week: BriefWeek, now: Date) {
  const from = week.previous.start;
  const to = week.current.end;
  const [lastGa, daily, channels, searchDaily, pages, queries, articles, index] = await Promise.all([
    property
      ? supabase
          .from("marketing_ga_daily")
          .select("day")
          .eq("property", property)
          .order("day", { ascending: false })
          .limit(1)
          .maybeSingle()
          .then(({ data, error }) => {
            if (error) throw new Error(error.message);
            return (data?.day as string | undefined) ?? null;
          })
      : null,
    property ? everyRow((start, end) => supabase.from("marketing_ga_daily").select("day, sessions, engaged_sessions, key_events").eq("property", property).gte("day", from).lte("day", to).order("day").range(start, end)) : null,
    property ? everyRow((start, end) => supabase.from("marketing_ga_channel_daily").select("day, channel, sessions").eq("property", property).gte("day", from).lte("day", to).order("day").order("channel").range(start, end)) : null,
    everyRow((start, end) => supabase.from("marketing_gsc_daily").select("day, clicks, impressions, position").eq("site", site).gte("day", from).lte("day", to).order("day").range(start, end)),
    compare(supabase, "marketing_gsc_page_compare", site, week),
    compare(supabase, "marketing_gsc_query_compare", site, week),
    loadArticles(supabase),
    loadIndexStatus().then((list) => indexSummary(list)),
  ]);
  return fitFacts(
    briefFacts({
      week,
      traffic:
        daily && channels
          ? {
              rows: daily.map((row) => ({ day: String(row.day), sessions: asNumber(row.sessions), engaged: asNumber(row.engaged_sessions), keyEvents: asNumber(row.key_events) })),
              channels: channels.map((row) => ({ day: String(row.day), channel: String(row.channel), sessions: asNumber(row.sessions) })),
              lastDay: lastGa,
            }
          : null,
      search: { rows: searchDaily.map((row) => ({ day: String(row.day), clicks: asNumber(row.clicks), impressions: asNumber(row.impressions), position: asNumber(row.position) })), pages, queries },
      articles,
      notIndexed: index.total - index.indexed,
      now,
    }),
  );
}

export async function runBrief({ force = false, actor = null, now = new Date() }: { force?: boolean; actor?: AiActor; now?: Date } = {}): Promise<BriefResult> {
  const { property, site } = googleSettings();
  if (!site) return { status: "no_data", key: null };
  const supabase = createAdminClient();
  const scope = aiScope();
  const { data: last, error } = await supabase.from("marketing_gsc_daily").select("day").eq("site", site).gt("impressions", 0).order("day", { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error(error.message);
  const week = briefWeek((last?.day as string | undefined) ?? null, zoneDay(now));
  if (!week) return { status: "no_data", key: null };
  const key = week.current.start;
  if (!force) {
    const { data: existing, error: lookup } = await supabase.from("marketing_ai_outputs").select("id").eq("scope", scope).eq("task", "brief").eq("key", key).maybeSingle();
    if (lookup) throw new Error(lookup.message);
    if (existing) return { status: "exists", key };
  }
  const facts = await gather(supabase, property, site, week, now);
  const result = await askAi({ task: "brief", instructions: briefInstructions, prompt: briefPrompt(facts), schema: briefSchema, maxTokens: 4000, actor });
  if (!result.ok) return { status: result.error, key };
  const flags = briefFlags(result.value, facts);
  const { error: saved } = await supabase
    .from("marketing_ai_outputs")
    .upsert({ scope, task: "brief", key, facts, content: result.value, flags, created_at: new Date().toISOString(), created_by: actor?.id ?? null, created_by_name: actor?.name ?? null }, { onConflict: "scope,task,key" });
  if (saved) throw new Error(saved.message);
  return { status: "created", key, flags };
}

export async function loadBriefs(limit = 13): Promise<StoredBrief[]> {
  const { data, error } = await createAdminClient().from("marketing_ai_outputs").select("key, content, flags, created_at").eq("scope", aiScope()).eq("task", "brief").order("key", { ascending: false }).limit(limit);
  if (error) throw new Error(error.message);
  const briefs: StoredBrief[] = [];
  for (const row of data ?? []) {
    const key = String(row.key);
    const content = briefSchema.safeParse(row.content);
    if (!isDay(key) || !content.success) continue;
    briefs.push({ key, start: key, end: addDays(key, 6), content: content.data, flags: Array.isArray(row.flags) ? row.flags.filter((flag): flag is string => typeof flag === "string") : [], createdAt: String(row.created_at) });
  }
  return briefs;
}
