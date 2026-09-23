import "server-only";

export const aiConfigured = Boolean(process.env.OPENAI_API_KEY);

const model = process.env.OPENAI_MODEL ?? "gpt-6-luna";

type OutputItem = { type: string; content?: Array<{ type: string; text?: string }> };

export class AiError extends Error {}

export async function generate(input: { instructions: string; prompt: string; json?: boolean; maxTokens?: number }) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new AiError("not_configured");
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model,
      instructions: input.instructions,
      input: input.prompt,
      max_output_tokens: input.maxTokens ?? 1500,
      ...(input.json ? { text: { format: { type: "json_object" } } } : {}),
    }),
    signal: AbortSignal.timeout(30000),
  });
  const data = (await response.json().catch(() => null)) as { error?: { message?: string }; output?: OutputItem[] } | null;
  if (!response.ok) throw new AiError(data?.error?.message ?? `HTTP ${response.status}`);
  const text = (data?.output ?? [])
    .flatMap((item) => item.content ?? [])
    .map((part) => part.text ?? "")
    .join("")
    .trim();
  if (!text) throw new AiError("empty");
  return text;
}
