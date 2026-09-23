import "server-only";
import type { ZodType } from "zod";
import { AiError, aiConfigured, aiPausedUntil, generate } from "@/lib/ai/openai";
import { createAdminClient } from "@/lib/supabase/admin";
import { aiMockBase, monthStart, monthlyLimit, readJson } from "./ai-math";
import { googleSettings } from "./google/config";

export type AiFailure = "not_configured" | "paused" | "capped" | "busy" | "invalid" | "timeout" | "quota" | "failed";

export type AiActor = { id: string; name: string } | null;

export type AiState = { configured: boolean; paused: boolean; used: number; limit: number };

const timeoutMs = 20000;

const staleMs = 60000;

export function aiScope() {
  const { property, site } = googleSettings();
  return `${property ?? ""}|${site ?? ""}`;
}

export const aiSettingsKey = (scope: string) => `ai:settings:${scope}`;

const mockBase = () => aiMockBase(process.env.MARKETING_AI_BASE);

export async function aiState(now = new Date()): Promise<AiState> {
  const scope = aiScope();
  const supabase = createAdminClient();
  const [setting, runs] = await Promise.all([
    supabase.from("marketing_sync_state").select("value").eq("key", aiSettingsKey(scope)).maybeSingle(),
    supabase.from("marketing_ai_runs").select("id", { count: "exact", head: true }).eq("scope", scope).gte("started_at", monthStart(now)),
  ]);
  if (setting.error) throw new Error(setting.error.message);
  if (runs.error) throw new Error(runs.error.message);
  return { configured: Boolean(mockBase()) || aiConfigured, paused: aiPausedUntil() > Date.now(), used: runs.count ?? 0, limit: monthlyLimit(setting.data?.value) };
}

async function send(task: string, instructions: string, prompt: string, maxTokens: number) {
  const base = mockBase();
  if (!base) return generate({ instructions, prompt, maxTokens, timeoutMs });
  const response = await fetch(`${base}/generate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ task, instructions, prompt, maxTokens }),
    signal: AbortSignal.timeout(timeoutMs),
  }).catch((cause: unknown) => {
    throw new AiError(cause instanceof Error && ["TimeoutError", "AbortError"].includes(cause.name) ? "timeout" : "unreachable");
  });
  const body = (await response.json().catch(() => null)) as { text?: unknown } | null;
  if (!response.ok) throw new AiError(response.status >= 500 ? "unavailable" : `HTTP ${response.status}`);
  if (typeof body?.text !== "string" || !body.text.trim()) throw new AiError("empty");
  return body.text;
}

function failureOf(cause: unknown): AiFailure {
  const message = cause instanceof AiError ? cause.message : "";
  if (message === "not_configured") return "not_configured";
  if (message === "timeout") return "timeout";
  if (message === "quota") return "quota";
  if (message === "rate_limited") return "paused";
  return "failed";
}

export async function askAi<Value>(input: { task: string; instructions: string; prompt: string; schema: ZodType<Value>; maxTokens: number; actor: AiActor }): Promise<{ ok: true; value: Value } | { ok: false; error: AiFailure }> {
  const state = await aiState();
  if (!state.configured) return { ok: false, error: "not_configured" };
  if (state.paused) return { ok: false, error: "paused" };
  if (state.used >= state.limit) return { ok: false, error: "capped" };
  const supabase = createAdminClient();
  const scope = aiScope();
  const { error: stale } = await supabase
    .from("marketing_ai_runs")
    .update({ finished_at: new Date().toISOString(), ok: false, error: "stale" })
    .eq("scope", scope)
    .eq("task", input.task)
    .is("finished_at", null)
    .lt("started_at", new Date(Date.now() - staleMs).toISOString());
  if (stale) return { ok: false, error: "failed" };
  const { data: run, error } = await supabase
    .from("marketing_ai_runs")
    .insert({ scope, task: input.task, input_chars: input.instructions.length + input.prompt.length, actor: input.actor?.id ?? null, actor_name: input.actor?.name ?? null })
    .select("id")
    .single();
  if (error?.code === "23505") return { ok: false, error: "busy" };
  if (error || !run) return { ok: false, error: "failed" };
  const { count, error: counted } = await supabase.from("marketing_ai_runs").select("id", { count: "exact", head: true }).eq("scope", scope).gte("started_at", monthStart(new Date()));
  if (counted || (count ?? 0) > state.limit) {
    await supabase.from("marketing_ai_runs").delete().eq("id", run.id);
    return { ok: false, error: counted ? "failed" : "capped" };
  }
  let text = "";
  let failure: AiFailure | null = null;
  try {
    text = await send(input.task, input.instructions, input.prompt, input.maxTokens);
  } catch (cause) {
    failure = failureOf(cause);
  }
  const parsed = failure ? null : readJson(text, input.schema);
  if (parsed && !parsed.ok) failure = "invalid";
  const detail = parsed && !parsed.ok ? `invalid:${parsed.reason}` : failure;
  const { error: closed } = await supabase.from("marketing_ai_runs").update({ finished_at: new Date().toISOString(), ok: failure === null, error: detail, output_chars: text.length }).eq("id", run.id);
  if (closed) console.error("[marketing:ai]", "run not closed");
  if (failure || !parsed?.ok) return { ok: false, error: failure ?? "invalid" };
  return { ok: true, value: parsed.value };
}
