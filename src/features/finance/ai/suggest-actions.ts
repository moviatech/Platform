"use server";

import { z } from "zod";
import { zonedParts } from "@/features/booking/time";
import { AiError, aiConfigured, aiPausedUntil, generate } from "@/lib/ai/openai";
import { requirePermission } from "@/lib/auth/staff";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadSuggestContext } from "./context";
import { AI_MONTHLY_CAP, parseSuggestion, suggestionPrompt, type Suggestion } from "./suggest";

export type SuggestState = { ok: true; suggestion: Suggestion; used: number } | { ok: false; error: "invalid" | "empty" | "not_configured" | "paused" | "capped" | "failed"; used?: number };

const input = z.object({
  vendor: z.string().max(160),
  note: z.string().max(1000),
  reference: z.string().max(160),
  amount: z.string().max(40),
  spentOn: z.string().max(10),
  locale: z.enum(["zh", "en"]),
});

export async function suggestExpense(raw: { vendor?: string; note?: string; reference?: string; amount?: string; spentOn?: string; locale?: string }): Promise<SuggestState> {
  const session = await requirePermission("finance.review");
  const parsed = input.safeParse({
    vendor: String(raw.vendor ?? "").trim(),
    note: String(raw.note ?? "").trim(),
    reference: String(raw.reference ?? "").trim(),
    amount: String(raw.amount ?? "").trim(),
    spentOn: String(raw.spentOn ?? "").trim(),
    locale: raw.locale === "en" ? "en" : "zh",
  });
  if (!parsed.success) return { ok: false, error: "invalid" };
  const entry = parsed.data;
  if (!entry.vendor && !entry.note) return { ok: false, error: "empty" };
  if (!aiConfigured) return { ok: false, error: "not_configured" };
  if (aiPausedUntil() > Date.now()) return { ok: false, error: "paused" };
  const today = zonedParts(new Date(), "America/Los_Angeles").date;
  const supabase = createAdminClient();
  const { data, error } = await supabase.rpc("fin_ai_reserve", { p_purpose: "expense_suggest", p_month: today.slice(0, 7), p_cap: AI_MONTHLY_CAP, p_user: session.userId });
  const reserved = data as { state: "ok" | "paused" | "capped"; id?: number; used?: number } | null;
  if (error || !reserved) return { ok: false, error: "failed" };
  if (reserved.state === "paused") return { ok: false, error: "paused" };
  if (reserved.state === "capped" || !reserved.id) return { ok: false, error: "capped", used: reserved.used };
  const used = reserved.used ?? 0;
  const finish = (status: "OK" | "INVALID" | "FAILED" | "LIMITED", detail: Record<string, unknown>) => supabase.from("fin_ai_runs").update({ status, detail, finished_at: new Date().toISOString() }).eq("id", reserved.id).eq("status", "PENDING");
  try {
    const context = await loadSuggestContext(today);
    const { instructions, prompt } = suggestionPrompt(context, entry);
    const text = await generate({ instructions, prompt, maxTokens: 2000, timeoutMs: 20000 });
    const suggestion = parseSuggestion(text, context);
    await finish(suggestion ? "OK" : "INVALID", suggestion ? { category: suggestion.category, capital: suggestion.capital, spread: suggestion.serviceFrom !== null } : { reply: text.slice(0, 300) });
    return suggestion ? { ok: true, suggestion, used } : { ok: false, error: "failed", used };
  } catch (cause) {
    const code = cause instanceof AiError ? cause.message : "error";
    const limited = code === "rate_limited" || code === "quota";
    await finish(limited ? "LIMITED" : "FAILED", { error: code });
    return { ok: false, error: limited ? "paused" : "failed", used };
  }
}
