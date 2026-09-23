import "server-only";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { aiScope, askAi, type AiActor, type AiFailure } from "./ai";
import { periodsEnding, zoneDay } from "./dates";
import { googleSettings } from "./google/config";
import { compare, loadArticles } from "./overview";
import { cleanTopics, topicArticles, topicQueries, topicsInstructions, topicsPrompt, topicsSchema, type Topic, type TopicFacts } from "./topics-math";

export type TopicsStatus = "created" | "exists" | "no_data" | "forbidden" | "cooldown" | AiFailure;

export type StoredTopics = { key: string; createdAt: string; topics: Topic[]; facts: TopicFacts };

const reuseMs = 20 * 3600 * 1000;

const cooldownMs = 5 * 60 * 1000;

const storedTopic = z.object({
  titleZh: z.string(),
  titleEn: z.string(),
  angle: z.string(),
  keywordsZh: z.array(z.string()),
  keywordsEn: z.array(z.string()),
  queries: z.array(z.string()),
  existing: z.string().nullable(),
});

const storedFacts = z.object({
  window: z.object({ start: z.string(), end: z.string() }),
  queries: z.array(z.object({ query: z.string(), clicks: z.number(), impressions: z.number(), position: z.number(), opportunity: z.boolean() })),
  articles: z.array(z.object({ slug: z.string(), titleZh: z.string(), titleEn: z.string(), category: z.string().nullable() })),
});

export async function loadTopics(): Promise<StoredTopics | null> {
  const { data, error } = await createAdminClient().from("marketing_ai_outputs").select("key, content, facts, created_at").eq("scope", aiScope()).eq("task", "topics").order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  const topics = z.object({ topics: z.array(storedTopic) }).safeParse(data.content);
  const facts = storedFacts.safeParse(data.facts);
  if (!topics.success || !facts.success) return null;
  return { key: String(data.key), createdAt: String(data.created_at), topics: topics.data.topics, facts: facts.data };
}

async function gatherFacts(site: string, now: Date): Promise<TopicFacts | null> {
  const supabase = createAdminClient();
  const { data: last, error } = await supabase.from("marketing_gsc_daily").select("day").eq("site", site).gt("impressions", 0).order("day", { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error(error.message);
  const lastDay = (last?.day as string | undefined) ?? null;
  if (!lastDay) return null;
  const periods = periodsEnding(lastDay, 28);
  const [rows, articles] = await Promise.all([compare(supabase, "marketing_gsc_query_compare", site, periods), loadArticles(supabase)]);
  const queries = topicQueries(rows);
  if (!queries.length) return null;
  return { window: periods.current, queries, articles: topicArticles(articles, now) };
}

async function coolingDown(latest: StoredTopics | null, now: Date) {
  const { data, error } = await createAdminClient().from("marketing_ai_runs").select("started_at").eq("scope", aiScope()).eq("task", "topics").order("started_at", { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return false;
  const started = Date.parse(String(data.started_at));
  const succeeded = latest !== null && Date.parse(latest.createdAt) >= started;
  return !succeeded && now.getTime() - started < cooldownMs;
}

export async function runTopics({ force = false, limited = false, actor = null, now = new Date() }: { force?: boolean; limited?: boolean; actor?: AiActor; now?: Date } = {}): Promise<{ status: TopicsStatus }> {
  const { site } = googleSettings();
  if (!site) return { status: "no_data" };
  const latest = await loadTopics();
  if (!force && latest && now.getTime() - Date.parse(latest.createdAt) < reuseMs) return { status: "exists" };
  if (limited && (await coolingDown(latest, now))) return { status: "cooldown" };
  const facts = await gatherFacts(site, now);
  if (!facts) return { status: "no_data" };
  const result = await askAi({ task: "topics", instructions: topicsInstructions, prompt: topicsPrompt(facts), schema: topicsSchema, maxTokens: 4000, actor });
  if (!result.ok) return { status: result.error };
  const topics = cleanTopics(result.value, facts);
  if (!topics.length) return { status: "invalid" };
  const { error } = await createAdminClient()
    .from("marketing_ai_outputs")
    .upsert({ scope: aiScope(), task: "topics", key: zoneDay(now), facts, content: { topics }, flags: [], created_at: new Date().toISOString(), created_by: actor?.id ?? null, created_by_name: actor?.name ?? null }, { onConflict: "scope,task,key" });
  if (error) throw new Error(error.message);
  return { status: "created" };
}
