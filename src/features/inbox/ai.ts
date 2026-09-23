import "server-only";
import { z } from "zod";
import { AiError, aiConfigured, aiPausedUntil, generate } from "@/lib/ai/openai";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatDate } from "@/lib/utils/format";
import { replyInstructions } from "./ai-prompt";
import { businessFacts } from "./knowledge";
import { personaName } from "./personas";
import { splitQuoted } from "./text";
import { summaryStale, summaryStatuses, type AiSummary } from "./types";

const company = "Movia Technologies, a Tesla rental company based in Irvine, California (moviatech.ai)";

type Row = {
  subject: string | null;
  customer_name: string | null;
  customer_email: string | null;
  locale: string | null;
  reservation: { number: string; pickup_at: string; return_at: string; vehicle_class: { name: string } | null } | null;
  lead: { kind: string; payload: Record<string, unknown> } | null;
};

type MessageRow = { conversation_id?: string; direction: string; body_text: string; created_at: string };

const transient = ["rate_limited", "timeout", "unreachable", "unavailable"];

const clean = (text: string | null | undefined, max = 2000) => splitQuoted(text ?? "").body.slice(0, max);

async function loadContext(conversationId: string, opening = false) {
  const supabase = createAdminClient();
  const [{ data: conversation }, { data: messages }] = await Promise.all([
    supabase
      .from("conversations")
      .select("subject, customer_name, customer_email, locale, reservation:reservations(number, pickup_at, return_at, vehicle_class:vehicle_classes(name)), lead:leads(kind, payload)")
      .eq("id", conversationId)
      .maybeSingle(),
    supabase.from("messages").select("direction, body_text, created_at").eq("conversation_id", conversationId).neq("direction", "INTERNAL").order("created_at", { ascending: opening }).limit(opening ? 3 : 8),
  ]);
  const row = conversation as unknown as Row | null;
  if (!row) return null;
  const payload = row.lead?.payload ?? {};
  const facts = [
    row.customer_name ? `Customer name: ${row.customer_name}` : null,
    row.customer_email ? `Customer email: ${row.customer_email}` : null,
    row.subject ? `Subject: ${row.subject}` : null,
    row.reservation ? `Confirmed reservation ${row.reservation.number}: ${formatDate(row.reservation.pickup_at)} to ${formatDate(row.reservation.return_at)}${row.reservation.vehicle_class ? `, ${row.reservation.vehicle_class.name}` : ""}` : null,
    typeof payload.pickupDate === "string" && typeof payload.returnDate === "string" ? `Requested dates (not yet confirmed): ${payload.pickupDate} to ${payload.returnDate}` : null,
    typeof payload.vehicleSlug === "string" ? `Requested vehicle (not yet confirmed): ${payload.vehicleSlug}` : null,
    typeof payload.topic === "string" ? `Inquiry topic: ${payload.topic}` : null,
  ].filter(Boolean);
  const ordered = opening ? ((messages ?? []) as MessageRow[]) : ((messages ?? []) as MessageRow[]).reverse();
  const transcript = ordered.map((message) => `${message.direction === "INBOUND" ? "Customer" : "Movia"} (${message.created_at.slice(0, 16).replace("T", " ")}):\n${clean(message.body_text, 1500)}`).join("\n\n");
  const asked = ordered
    .filter((message) => message.direction === "INBOUND")
    .slice(-3)
    .map((message) => clean(message.body_text, 1500))
    .join("\n");
  return { facts: facts.join("\n"), transcript, asked: [row.subject ?? "", asked].join("\n"), locale: row.locale };
}

async function loadExamples(limit = 4) {
  const supabase = createAdminClient();
  const { data: replies } = await supabase.from("messages").select("conversation_id, direction, body_text, created_at").eq("direction", "OUTBOUND").not("sent_by", "is", null).order("created_at", { ascending: false }).limit(40);
  const picked = ((replies ?? []) as MessageRow[]).filter((reply) => clean(reply.body_text).length >= 150).slice(0, limit);
  if (!picked.length) return "";
  const { data: inbound } = await supabase
    .from("messages")
    .select("conversation_id, direction, body_text, created_at")
    .eq("direction", "INBOUND")
    .in("conversation_id", [...new Set(picked.map((reply) => reply.conversation_id as string))])
    .order("created_at", { ascending: true });
  const customerBefore = (reply: MessageRow) => ((inbound ?? []) as MessageRow[]).filter((message) => message.conversation_id === reply.conversation_id && message.created_at < reply.created_at).at(-1);
  return picked
    .map((reply, index) => {
      const customer = customerBefore(reply);
      return `Example ${index + 1}\nCUSTOMER_MESSAGE: ${customer ? clean(customer.body_text, 500) : "(not available)"}\nMOVIA_REPLY: ${clean(reply.body_text, 900)}`;
    })
    .join("\n\n");
}

export async function composeReply(input: { conversationId: string; draft: string; language: "zh" | "en"; persona: string; mode: "polish" | "draft" }) {
  const context = await loadContext(input.conversationId);
  if (!context) return null;
  const [facts, examples] = await Promise.all([businessFacts(`${context.asked}\n${input.draft}`), loadExamples()]);
  const instructions = examples ? `${replyInstructions}\n\nSTYLE_EXAMPLES\nReplies previously written by Movia staff. Match their tone, warmth and length; never reuse their facts for a different customer.\n\n${examples}` : replyInstructions;
  const prompt = [
    `VERIFIED_BUSINESS_FACTS:\n${facts}`,
    `MODE: ${input.mode === "draft" ? "AUTO_DRAFT" : "STAFF_POLISH"}`,
    `REPLY_LANGUAGE: ${input.language === "zh" ? "Chinese" : "English"}`,
    `STAFF_ROLE: ${personaName(input.persona, "en")}`,
    `CUSTOMER_CONTEXT:\n${context.facts || "(none)"}`,
    `CUSTOMER_MESSAGE (full conversation, newest last):\n${context.transcript || "(none)"}`,
    `STAFF_NOTES:\n${input.mode === "draft" ? "(none, AUTO_DRAFT)" : input.draft}`,
  ].join("\n\n");
  return generate({ instructions, prompt, maxTokens: 2500, waitOnLimitMs: 7000 });
}

const summarySchema = z.object({
  title_zh: z.string().trim().min(1).max(40),
  title_en: z.string().trim().min(1).max(80),
});

const summaryInstructions = [
  `Write a one-line title for a customer-service conversation of ${company}, shown in the staff inbox list.`,
  'Return a JSON object with keys "title_zh" and "title_en".',
  "The title says what the customer wrote in about, based on the opening messages only: at most 16 Chinese characters / 9 English words. If Movia wrote first, say what Movia contacted the customer about.",
  "Plain text only, no markdown, no quotes, no customer email addresses.",
].join("\n");

const clip = (value: unknown, max: number) => (typeof value === "string" ? value.trim().slice(0, max) : value);

export async function summarize(conversationId: string) {
  const supabase = createAdminClient();
  const { data: claimed } = await supabase
    .from("conversations")
    .update({ ai_summary_at: new Date().toISOString() })
    .eq("id", conversationId)
    .is("ai_summary", null)
    .or(`ai_summary_at.is.null,ai_summary_at.lt.${new Date(Date.now() - 60000).toISOString()}`)
    .select("id");
  if (!claimed?.length) return false;
  try {
    const context = await loadContext(conversationId, true);
    if (!context || !context.transcript) return false;
    const text = await generate({ instructions: summaryInstructions, prompt: `Facts:\n${context.facts || "(none)"}\n\nOpening messages:\n${context.transcript}\n\nReturn only the JSON object.`, maxTokens: 1500, timeoutMs: 16000 });
    const raw = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)) as Record<string, unknown>;
    const summary: AiSummary = summarySchema.parse({ title_zh: clip(raw.title_zh, 40), title_en: clip(raw.title_en, 80) });
    await supabase.from("conversations").update({ ai_summary: summary }).eq("id", conversationId);
    return true;
  } catch (error) {
    if (error instanceof AiError && transient.includes(error.message)) await supabase.from("conversations").update({ ai_summary_at: null }).eq("id", conversationId).is("ai_summary", null);
    const reason = error instanceof AiError ? error.message : error instanceof SyntaxError ? "not_json" : error instanceof Error ? error.name : "failed";
    console.error("[inbox:summary]", conversationId, reason);
    return reason.slice(0, 160);
  }
}

const summaryBatch = 2;
const summariesPerMinute = 4;

export async function summarizeStale(ids: string[]): Promise<{ updated: number; failed: string | null }> {
  if (!aiConfigured || !ids.length) return { updated: 0, failed: null };
  const supabase = createAdminClient();
  const now = Date.now();
  if (now < aiPausedUntil()) return { updated: 0, failed: "paused" };
  const [{ data }, { count: recent }] = await Promise.all([
    supabase.from("conversations").select("id, last_message_at, ai_summary_at, ai_summary").in("id", ids.slice(0, 20)).in("status", summaryStatuses),
    supabase.from("conversations").select("id", { count: "exact", head: true }).gt("ai_summary_at", new Date(now - 60000).toISOString()),
  ]);
  const room = Math.max(0, Math.min(summaryBatch, summariesPerMinute - (recent ?? 0)));
  const stale = (data ?? []).filter((row) => summaryStale(row, now)).slice(0, room);
  const done = await Promise.all(stale.map((row) => summarize(row.id)));
  return { updated: done.filter((result) => result === true).length, failed: done.find((result): result is string => typeof result === "string") ?? null };
}
