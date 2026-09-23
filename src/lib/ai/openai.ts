import "server-only";

export const aiConfigured = Boolean(process.env.OPENAI_API_KEY);

const model = process.env.OPENAI_MODEL ?? "gpt-6-luna";
const effort = process.env.OPENAI_REASONING_EFFORT ?? "low";

type OutputItem = { type: string; content?: Array<{ type: string; text?: string }> };
type Body = { error?: { message?: string; param?: string | null; code?: string | null; type?: string | null }; output?: OutputItem[] } | null;

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

export async function generate(input: { instructions: string; prompt: string; maxTokens?: number; timeoutMs?: number; waitOnLimitMs?: number }) {
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
    const text = (data?.output ?? [])
      .flatMap((item) => item.content ?? [])
      .map((part) => part.text ?? "")
      .join("")
      .trim();
    if (!text) throw new AiError("empty");
    return text;
  }
}
