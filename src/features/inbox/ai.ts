import "server-only";
import { after } from "next/server";
import { z } from "zod";
import { aiConfigured, generate } from "@/lib/ai/openai";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatDate } from "@/lib/utils/format";
import { replyInstructions } from "./ai-prompt";
import { businessFacts } from "./knowledge";
import { personaName } from "./personas";
import { splitQuoted } from "./text";
import type { AiSummary } from "./types";

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

const clean = (text: string | null | undefined, max = 2000) => splitQuoted(text ?? "").body.slice(0, max);

async function loadContext(conversationId: string) {
  const supabase = createAdminClient();
  const [{ data: conversation }, { data: messages }] = await Promise.all([
    supabase
      .from("conversations")
      .select("subject, customer_name, customer_email, locale, reservation:reservations(number, pickup_at, return_at, vehicle_class:vehicle_classes(name)), lead:leads(kind, payload)")
      .eq("id", conversationId)
      .maybeSingle(),
    supabase.from("messages").select("direction, body_text, created_at").eq("conversation_id", conversationId).neq("direction", "INTERNAL").order("created_at", { ascending: false }).limit(12),
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
  const transcript = ((messages ?? []) as MessageRow[])
    .reverse()
    .map((message) => `${message.direction === "INBOUND" ? "Customer" : "Movia"} (${message.created_at.slice(0, 16).replace("T", " ")}):\n${clean(message.body_text)}`)
    .join("\n\n");
  return { facts: facts.join("\n"), transcript, locale: row.locale };
}

async function loadExamples(limit = 8) {
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
      return `Example ${index + 1}\nCUSTOMER_MESSAGE: ${customer ? clean(customer.body_text, 1200) : "(not available)"}\nMOVIA_REPLY: ${clean(reply.body_text, 1800)}`;
    })
    .join("\n\n");
}

export async function composeReply(input: { conversationId: string; draft: string; language: "zh" | "en"; persona: string; mode: "polish" | "draft" }) {
  const [context, facts, examples] = await Promise.all([loadContext(input.conversationId), businessFacts(), loadExamples()]);
  if (!context) return null;
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
  return generate({ instructions, prompt, maxTokens: 2500 });
}

const summarySchema = z.object({
  title_zh: z.string().trim().min(1).max(40),
  title_en: z.string().trim().min(1).max(80),
  summary_zh: z.string().trim().min(1).max(160),
  summary_en: z.string().trim().min(1).max(240),
});

const summaryInstructions = [
  `Summarize a customer-service conversation of ${company} for the staff inbox list.`,
  'Return a JSON object with keys "title_zh", "title_en", "summary_zh", "summary_en".',
  "Title: the topic in at most 12 Chinese characters / 6 English words. Summary: one sentence, at most 40 Chinese characters / 25 English words, stating what the customer wants and where things stand (waiting for Movia, answered, resolved).",
  "Plain text only, no markdown, no quotes, no customer email addresses.",
].join("\n");

export async function summarize(conversationId: string) {
  const supabase = createAdminClient();
  await supabase.from("conversations").update({ ai_summary_at: new Date().toISOString() }).eq("id", conversationId);
  try {
    const context = await loadContext(conversationId);
    if (!context || !context.transcript) return;
    const text = await generate({ instructions: summaryInstructions, prompt: `Facts:\n${context.facts || "(none)"}\n\nConversation:\n${context.transcript}`, json: true });
    const summary: AiSummary = summarySchema.parse(JSON.parse(text));
    await supabase.from("conversations").update({ ai_summary: summary }).eq("id", conversationId);
  } catch (error) {
    await supabase.from("conversations").update({ ai_summary_at: null }).eq("id", conversationId);
    throw error;
  }
}

export function scheduleSummaries(items: Array<{ id: string; last_message_at: string; ai_summary_at?: string | null }>) {
  if (!aiConfigured) return;
  const stale = items.filter((item) => !item.ai_summary_at || Date.parse(item.ai_summary_at) < Date.parse(item.last_message_at)).slice(0, 5);
  if (!stale.length) return;
  after(async () => {
    for (const item of stale) await summarize(item.id).catch(() => undefined);
  });
}
