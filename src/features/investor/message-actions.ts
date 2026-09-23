"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { requireInvestor } from "@/lib/auth/investor";
import { createAdminClient } from "@/lib/supabase/admin";
import { topics } from "./message-types";
import { notifyStaffInvestorEvent } from "./notify";

export type MessageState = { ok?: boolean; error?: "invalid" | "failed" | "closed" | "rate_limited" };

const topicSubjects: Record<(typeof topics)[number], { zh: string; en: string }> = {
  earnings: { zh: "收益与分成", en: "Earnings" },
  withdrawal: { zh: "提现", en: "Withdrawal" },
  vehicle: { zh: "车辆", en: "Vehicle" },
  agreement: { zh: "协议与文件", en: "Agreement & documents" },
  exit: { zh: "退出", en: "Exit" },
  other: { zh: "其他", en: "Other" },
};

const preview = (text: string) => text.replace(/\s+/g, " ").slice(0, 140);

export async function createInvestorConversation(_: MessageState, form: FormData): Promise<MessageState> {
  const session = await requireInvestor();
  const parsed = z.object({ topic: z.enum(topics), message: z.string().trim().min(2).max(3000) }).safeParse({ topic: form.get("topic"), message: form.get("message") });
  if (!parsed.success) return { error: "invalid" };
  const subject = `${topicSubjects[parsed.data.topic][session.language]} · ${session.number}`;
  const supabase = createAdminClient();
  const since = new Date(Date.now() - 10 * 60000).toISOString();
  const { count } = await supabase.from("audit_events").select("id", { count: "exact", head: true }).eq("actor_user_id", session.userId).eq("action", "investor.message_created").gte("created_at", since);
  if ((count ?? 0) >= 10) return { error: "rate_limited" };
  const { data: conversation, error } = await supabase
    .from("conversations")
    .insert({ mailbox: "contact", subject, customer_email: session.email, customer_name: session.legalName, investor_id: session.investorId, locale: session.language, last_message_preview: preview(parsed.data.message), last_direction: "INBOUND" })
    .select("id")
    .single();
  if (error || !conversation) return { error: "failed" };
  await supabase.from("messages").insert({ conversation_id: conversation.id, direction: "INBOUND", channel: "WEB_FORM", from_email: session.email, from_name: session.legalName, subject, body_text: parsed.data.message, delivery_status: "RECEIVED" });
  await audit({ actorUserId: session.userId, actorType: "INVESTOR", action: "investor.message_created", entityType: "conversation", entityId: conversation.id, metadata: { topic: parsed.data.topic } });
  await notifyStaffInvestorEvent("investor_message", { name: session.legalName, subject }, `/inbox/${conversation.id}`, `investor_message:${conversation.id}`);
  revalidatePath("/investor/messages", "layout");
  redirect(`/messages/${conversation.id}`);
}

export async function replyInvestorConversation(_: MessageState, form: FormData): Promise<MessageState> {
  const session = await requireInvestor();
  const parsed = z.object({ conversationId: z.uuid(), message: z.string().trim().min(1).max(3000) }).safeParse({ conversationId: form.get("conversationId"), message: form.get("message") });
  if (!parsed.success) return { error: "invalid" };
  const supabase = createAdminClient();
  const { data: conversation } = await supabase.from("conversations").select("id, subject, status, ended_at").eq("id", parsed.data.conversationId).eq("investor_id", session.investorId).maybeSingle();
  if (!conversation) return { error: "invalid" };
  if (conversation.ended_at || conversation.status === "RESOLVED") return { error: "closed" };
  const now = new Date().toISOString();
  const { error } = await supabase.from("messages").insert({ conversation_id: conversation.id, direction: "INBOUND", channel: "PORTAL", from_email: session.email, from_name: session.legalName, subject: conversation.subject, body_text: parsed.data.message, delivery_status: "RECEIVED" });
  if (error) return { error: "failed" };
  await supabase.from("conversations").update({ status: "OPEN", unread: true, last_message_at: now, last_message_preview: preview(parsed.data.message), last_direction: "INBOUND", customer_read_at: now, customer_unread: false }).eq("id", conversation.id);
  revalidatePath(`/investor/messages/${conversation.id}`);
  return { ok: true };
}
