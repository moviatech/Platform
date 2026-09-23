import "server-only";
import { sendEmail, sesMessageIdHeader } from "@/lib/email";
import { renderEmail, type EmailBlock } from "@/lib/email/template";
import { rootDomain } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import { personas, type PersonaId } from "./personas";
import { extractMessageIds, preview, replySubject } from "./text";
import { replyChannelFor } from "./types";

type Actor = { userId: string | null; displayName: string };

export type ReplyInput = { body: string; actor: Actor; persona?: PersonaId };

export type PortalTarget = {
  id: string;
  mailbox: string;
  subject: string | null;
  customer_email: string | null;
  customer_id: string | null;
  locale: string | null;
  customer_read_at: string | null;
  customer_notified_at: string | null;
};

export const conversationTargetColumns = "id, mailbox, subject, customer_email, customer_id, locale, customer_read_at, customer_notified_at";

const activeWindowMs = 15 * 60 * 1000;

const digest = {
  zh: {
    subject: (topic: string) => `Movia 回复了你的消息 · ${topic}`,
    title: "我们回复了你的消息",
    intro: (topic: string) => `关于「${topic}」有新的回复，请登录 Movia 客户中心查看。`,
    cta: "查看回复",
  },
  en: {
    subject: (topic: string) => `Movia replied · ${topic}`,
    title: "We replied to your message",
    intro: (topic: string) => `There is a new reply about "${topic}" waiting in your Movia account.`,
    cta: "View reply",
  },
};

const personaFor = (id?: PersonaId) => personas.find((item) => item.id === (id ?? "support")) ?? personas[0];

const personaLabel = (persona: (typeof personas)[number], locale: string | null) => `Movia ${locale === "zh" ? persona.zh : persona.en}`;

export async function notifyPortalReply(conversation: PortalTarget) {
  if (!conversation.customer_email) return { sent: false as const };
  const readAt = conversation.customer_read_at ? Date.parse(conversation.customer_read_at) : 0;
  if (Date.now() - readAt < activeWindowMs) return { sent: false as const };
  const notifiedAt = conversation.customer_notified_at ? Date.parse(conversation.customer_notified_at) : 0;
  if (notifiedAt > readAt) return { sent: false as const };
  const copy = digest[conversation.locale === "zh" ? "zh" : "en"];
  const topic = conversation.subject || "Movia";
  const rendered = renderEmail({
    title: copy.title,
    blocks: [
      { type: "paragraph", text: copy.intro(topic) },
      { type: "button", label: copy.cta, href: `https://account.${rootDomain}/messages/${conversation.id}` },
    ],
  });
  const result = await sendEmail({ to: conversation.customer_email, subject: copy.subject(topic), text: rendered.text, html: rendered.html });
  if (result.sent) await createAdminClient().from("conversations").update({ customer_notified_at: new Date().toISOString() }).eq("id", conversation.id);
  return result;
}

export async function postPortalMessage(conversation: PortalTarget, input: ReplyInput) {
  const supabase = createAdminClient();
  const now = new Date().toISOString();
  await supabase.from("messages").insert({
    conversation_id: conversation.id,
    direction: "OUTBOUND",
    channel: "PORTAL",
    from_name: `${personaLabel(personaFor(input.persona), conversation.locale)} · ${input.actor.displayName}`,
    to_email: conversation.customer_email,
    subject: conversation.subject,
    body_text: input.body,
    delivery_status: "DELIVERED",
    sent_by: input.actor.userId,
  });
  await supabase
    .from("conversations")
    .update({ status: "PENDING_CUSTOMER", unread: false, customer_unread: true, last_message_at: now, last_message_preview: preview(input.body), last_direction: "OUTBOUND" })
    .eq("id", conversation.id);
  if (conversation.customer_id) await notifyPortalReply(conversation).catch(() => undefined);
  return { sent: true as const };
}

export function replyHtml(conversation: PortalTarget, body: string, signature: string) {
  const blocks: EmailBlock[] = body
    .replace(/\r\n/g, "\n")
    .split(/\n\s*\n/)
    .map((text) => text.trim())
    .filter(Boolean)
    .map((text) => ({ type: "paragraph", text }));
  blocks.push({ type: "divider" }, { type: "paragraph", text: signature });
  if (conversation.customer_id) {
    blocks.push({
      type: "button",
      label: conversation.locale === "zh" ? "在客户中心查看" : "View in your account",
      href: `https://account.${rootDomain}/messages/${conversation.id}`,
    });
  }
  return renderEmail({ preheader: preview(body), title: conversation.subject || "Movia", blocks }).html;
}

export async function sendEmailReply(conversation: PortalTarget & { customer_email: string }, input: ReplyInput) {
  const supabase = createAdminClient();
  const persona = personaFor(input.persona);
  const fromName = `Movia ${persona.en}`;
  const signature = `${input.actor.displayName} · ${personaLabel(persona, conversation.locale)}`;

  const { data: thread } = await supabase
    .from("messages")
    .select("message_id_header, references_header")
    .eq("conversation_id", conversation.id)
    .eq("channel", "EMAIL")
    .not("message_id_header", "is", null)
    .order("created_at", { ascending: false })
    .limit(1);
  const previous = thread?.[0];
  const headers: Record<string, string> = {};
  if (previous?.message_id_header) {
    const chain = [...extractMessageIds(previous.references_header), previous.message_id_header].slice(-12);
    headers["In-Reply-To"] = previous.message_id_header;
    headers["References"] = [...new Set(chain)].join(" ");
  }
  const subject = previous ? replySubject(conversation.subject) : conversation.subject || "Movia";
  const result = await sendEmail({
    from: `${fromName} <${conversation.mailbox}@${rootDomain}>`,
    to: conversation.customer_email,
    subject,
    text: `${input.body}\n\n—\n${signature}\nMovia Technologies · https://www.${rootDomain}`,
    html: replyHtml(conversation, input.body, signature),
    headers: Object.keys(headers).length ? headers : undefined,
  });
  await supabase.from("messages").insert({
    conversation_id: conversation.id,
    direction: "OUTBOUND",
    channel: "EMAIL",
    from_email: `${conversation.mailbox}@${rootDomain}`,
    from_name: `${fromName} · ${input.actor.displayName}`,
    to_email: conversation.customer_email,
    subject,
    body_text: input.body,
    message_id_header: result.sent && result.messageId ? sesMessageIdHeader(result.messageId) : null,
    in_reply_to: headers["In-Reply-To"] ?? null,
    references_header: headers["References"] ?? null,
    provider_message_id: result.sent ? result.messageId || null : null,
    delivery_status: result.sent ? "SENT" : "FAILED",
    delivery_error: result.sent ? null : result.reason,
    sent_by: input.actor.userId,
  });
  if (result.sent) {
    await supabase
      .from("conversations")
      .update({ status: "PENDING_CUSTOMER", unread: false, last_message_at: new Date().toISOString(), last_message_preview: preview(input.body), last_direction: "OUTBOUND" })
      .eq("id", conversation.id);
  }
  return result;
}

export async function postConversationMessage(input: { conversationId: string } & ReplyInput) {
  const { data: conversation } = await createAdminClient().from("conversations").select(conversationTargetColumns).eq("id", input.conversationId).maybeSingle();
  if (!conversation) return { sent: false as const };
  return replyChannelFor(conversation) === "EMAIL" && conversation.customer_email ? sendEmailReply(conversation, input) : postPortalMessage(conversation, input);
}
