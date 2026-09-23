import "server-only";
import { citedSources, outputText, type AiOutputItem, type AiSource } from "./sources";

export type { AiSource } from "./sources";

export const aiConfigured = Boolean(process.env.OPENAI_API_KEY);

const model = process.env.OPENAI_MODEL ?? "gpt-6-luna";
const effort = process.env.OPENAI_REASONING_EFFORT ?? "low";

type Body = { id?: string; status?: string; incomplete_details?: { reason?: string } | null; error?: { message?: string; param?: string | null; code?: string | null; type?: string | null } | null; output?: AiOutputItem[] } | null;
type GenerateInput = { instructions: string; prompt: string; maxTokens?: number; timeoutMs?: number; waitOnLimitMs?: number };

export type SourcedAnswer = { text: string; sources: AiSource[] };
export type SourcedJob = { status: "pending" } | ({ status: "done" } & SourcedAnswer) | { status: "failed"; error: string };

export class AiError extends Error {
  constructor(
    message: string,
    public detail?: string,
  ) {
    super(message);
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

let pausedUntil = 0;

export const aiPausedUntil = () => pausedUntil;

export function waitSeconds(message: string | undefined) {
  const found = message?.match(/try again in (?:(\d+)h)?(?:(\d+)m(?!s))?(?:([\d.]+)s)?(?:(\d+)ms)?/i);
  if (!found || found.slice(1).every((part) => part === undefined)) return null;
  return Number(found[1] ?? 0) * 3600 + Number(found[2] ?? 0) * 60 + Number(found[3] ?? 0) + Number(found[4] ?? 0) / 1000;
}

function retryDelay(response: Response) {
  const ms = Number(response.headers.get("retry-after-ms"));
  if (Number.isFinite(ms) && ms > 0) return ms;
  const seconds = Number(response.headers.get("retry-after"));
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : null;
}

function answered(data: Body): SourcedAnswer {
  if (data?.status === "incomplete") throw new AiError("incomplete", data.incomplete_details?.reason);
  const text = outputText((data?.output ?? []).filter((item) => item.type === "message").slice(-1));
  if (!text) throw new AiError("empty");
  return { text, sources: citedSources(data?.output) };
}

export async function generate(input: GenerateInput) {
  const text = outputText((await request(input, {}))?.output);
  if (!text) throw new AiError("empty");
  return text;
}

export async function generateWithSources(input: GenerateInput & { webSearch?: boolean }): Promise<SourcedAnswer> {
  if (input.webSearch === false) return { text: await generate(input), sources: [] };
  return answered(await request(input, { webSearch: true }));
}

export async function startWithSources(input: GenerateInput): Promise<{ id: string }> {
  const data = await request(input, { webSearch: true, background: true });
  if (!data?.id) throw new AiError("empty");
  return { id: data.id };
}

export async function readWithSources(id: string, timeoutMs = 10000): Promise<SourcedJob> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new AiError("not_configured");
  if (!/^[A-Za-z0-9_-]{6,200}$/.test(id)) throw new AiError("not_found");
  const response = await fetch(`https://api.openai.com/v1/responses/${id}`, { headers: { authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(timeoutMs) }).catch((cause: unknown) => {
    throw new AiError(cause instanceof Error && ["TimeoutError", "AbortError"].includes(cause.name) ? "timeout" : "unreachable");
  });
  const data = (await response.json().catch(() => null)) as Body;
  if (response.status === 404) throw new AiError("not_found");
  if (response.status >= 500) throw new AiError("unavailable");
  if (!response.ok) throw new AiError(data?.error?.message ?? `HTTP ${response.status}`);
  if (data?.status === "queued" || data?.status === "in_progress") return { status: "pending" };
  if (data?.status !== "completed" && data?.status !== "incomplete") return { status: "failed", error: data?.error?.message ?? data?.status ?? "failed" };
  try {
    return { status: "done", ...answered(data) };
  } catch (cause) {
    return { status: "failed", error: cause instanceof AiError ? cause.message : "failed" };
  }
}

async function request(input: GenerateInput, options: { webSearch?: boolean; background?: boolean }): Promise<Body> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new AiError("not_configured");
  const deadline = Date.now() + (input.timeoutMs ?? 22000);
  let reasoning = effort !== "default";
  let waited = false;
  for (;;) {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model,
        instructions: input.instructions,
        input: input.prompt,
        max_output_tokens: input.maxTokens ?? 1500,
        ...(reasoning ? { reasoning: { effort } } : {}),
        ...(options.webSearch ? { tools: [{ type: "web_search" }], tool_choice: "required" } : {}),
        ...(options.background ? { background: true, store: true } : {}),
      }),
      signal: AbortSignal.timeout(Math.max(1000, deadline - Date.now())),
    }).catch((cause: unknown) => {
      throw new AiError(cause instanceof Error && ["TimeoutError", "AbortError"].includes(cause.name) ? "timeout" : "unreachable");
    });
    const data = (await response.json().catch(() => null)) as Body;
    if (response.status === 400 && reasoning && /reasoning/i.test(`${data?.error?.param ?? ""} ${data?.error?.message ?? ""}`)) {
      reasoning = false;
      continue;
    }
    if (response.status === 429) {
      const detail = data?.error?.message?.slice(0, 300);
      pausedUntil = Date.now() + Math.min(21600, Math.max(60, waitSeconds(detail) ?? 60)) * 1000;
      if (data?.error?.code === "insufficient_quota" || data?.error?.type === "insufficient_quota" || (waitSeconds(detail) ?? 0) > 120) throw new AiError("quota", detail);
      const delay = retryDelay(response);
      if (!waited && delay !== null && delay <= (input.waitOnLimitMs ?? 0) && Date.now() + delay < deadline - 8000) {
        waited = true;
        await sleep(delay);
        continue;
      }
      throw new AiError("rate_limited", detail);
    }
    if (response.status >= 500) throw new AiError("unavailable");
    if (!response.ok) throw new AiError(data?.error?.message ?? `HTTP ${response.status}`);
    return data;
  }
}
