import "server-only";
import PostalMime from "postal-mime";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { rootDomain } from "@/lib/env";
import { extractMessageIds, htmlToText, normalizeSubject, preview, safeFilename } from "./text";
import { mailboxes, type Mailbox } from "./types";

const blockedExtensions = /\.(exe|bat|cmd|com|scr|js|jse|vbs|vbe|wsf|wsh|msi|ps1|jar|lnk|hta|cpl|dll)$/i;
const maxAttachmentBytes = 10 * 1024 * 1024;
const maxAttachments = 10;
const fallbackWindowDays = 30;

type Envelope = { to: string; from: string };

export type IngestResult = { status: "stored" | "duplicate" | "ignored"; conversationId?: string; messageId?: string };

function mailboxFor(address: string): Mailbox {
  const local = address.split("@")[0]?.split("+")[0]?.toLowerCase() ?? "";
  return (mailboxes as readonly string[]).includes(local) ? (local as Mailbox) : "contact";
}

function tokenFrom(address: string) {
  const match = address.toLowerCase().match(/^reply\+([a-z0-9]{12,40})@/);
  return match?.[1] ?? null;
}

async function findConversation(
  supabase: SupabaseClient,
  envelopeTo: string,
  referenced: string[],
  senderEmail: string,
  subject: string,
) {
  const token = tokenFrom(envelopeTo);
  if (token) {
    const { data } = await supabase.from("conversations").select("id").eq("token", token).maybeSingle();
    if (data) return data.id as string;
  }

  if (referenced.length) {
    const { data } = await supabase.from("messages").select("conversation_id").in("message_id_header", referenced).limit(1);
    if (data?.[0]) return data[0].conversation_id as string;

    const providerIds = referenced.map((id) => id.slice(1, -1).split("@")[0]).filter(Boolean);
    const { data: byProvider } = await supabase.from("messages").select("conversation_id").in("provider_message_id", providerIds).limit(1);
    if (byProvider?.[0]) return byProvider[0].conversation_id as string;
  }

  const normalized = normalizeSubject(subject);
  if (normalized) {
    const since = new Date(Date.now() - fallbackWindowDays * 86400000).toISOString();
    const { data } = await supabase
      .from("conversations")
      .select("id, subject")
      .eq("customer_email", senderEmail)
      .neq("status", "SPAM")
      .gte("last_message_at", since)
      .order("last_message_at", { ascending: false })
      .limit(10);
    const match = (data ?? []).find((row) => normalizeSubject(row.subject as string | null) === normalized);
    if (match) return match.id as string;
  }
  return null;
}

export async function ingestEmail(raw: ArrayBuffer, envelope: Envelope): Promise<IngestResult> {
  const email = await PostalMime.parse(raw);
  const senderEmail = (email.from?.address || envelope.from || "").trim().toLowerCase();
  if (!senderEmail || senderEmail.endsWith(`@${rootDomain}`)) return { status: "ignored" };
  const header = (name: string) => email.headers.find((item) => item.key.toLowerCase() === name)?.value ?? "";
  const bounce = /report-type=delivery-status/i.test(header("content-type")) || /^auto-/i.test(header("auto-submitted")) || /^(mailer-daemon|postmaster)@/i.test(senderEmail);

  const supabase = createAdminClient();
  const messageIdHeader = email.messageId?.trim() || null;

  if (messageIdHeader) {
    const { data: existing } = await supabase.from("messages").select("id, conversation_id").eq("message_id_header", messageIdHeader).maybeSingle();
    if (existing) return { status: "duplicate", conversationId: existing.conversation_id, messageId: existing.id };
  }

  const subject = (email.subject ?? "").trim().slice(0, 300);
  const bodyText = (email.text?.trim() || (email.html ? htmlToText(email.html) : "")).slice(0, 100000);
  const referenced = extractMessageIds(email.inReplyTo, email.references);
  const senderName = email.from?.name?.trim().slice(0, 120) || null;

  let conversationId = await findConversation(supabase, envelope.to, referenced, senderEmail, subject);

  if (!conversationId) {
    const { data: created, error } = await supabase
      .from("conversations")
      .insert({
        mailbox: mailboxFor(envelope.to),
        subject: subject || null,
        customer_email: senderEmail,
        customer_name: senderName,
      })
      .select("id")
      .single();
    if (error || !created) throw new Error(`conversation_insert:${error?.message}`);
    conversationId = created.id as string;
  }

  const { data: message, error: messageError } = await supabase
    .from("messages")
    .insert({
      conversation_id: conversationId,
      direction: "INBOUND",
      channel: "EMAIL",
      from_email: senderEmail,
      from_name: senderName,
      to_email: envelope.to.toLowerCase(),
      subject: subject || null,
      body_text: bodyText,
      body_html: email.html?.slice(0, 400000) ?? null,
      message_id_header: messageIdHeader,
      in_reply_to: email.inReplyTo?.slice(0, 1000) ?? null,
      references_header: email.references?.slice(0, 4000) ?? null,
      delivery_status: "RECEIVED",
    })
    .select("id")
    .single();

  if (messageError || !message) {
    if (messageError?.code === "23505") return { status: "duplicate", conversationId };
    throw new Error(`message_insert:${messageError?.message}`);
  }

  const files = email.attachments
    .filter((file) => file.disposition !== "inline" || !file.mimeType.startsWith("image/") || !email.html)
    .slice(0, maxAttachments);

  for (const [index, file] of files.entries()) {
    const filename = (file.filename ?? `attachment-${index + 1}`).slice(0, 200);
    const content = typeof file.content === "string" ? new TextEncoder().encode(file.content) : new Uint8Array(file.content);
    if (blockedExtensions.test(filename) || content.byteLength === 0 || content.byteLength > maxAttachmentBytes) continue;
    const path = `conversations/${conversationId}/${message.id}/${index}-${safeFilename(filename)}`;
    const { error: uploadError } = await supabase.storage
      .from("message-attachments")
      .upload(path, content, { contentType: file.mimeType || "application/octet-stream", upsert: false });
    if (uploadError) {
      console.error("[inbox:attachment]", uploadError.message);
      continue;
    }
    await supabase.from("message_attachments").insert({
      message_id: message.id,
      storage_path: path,
      filename,
      mime_type: file.mimeType || "application/octet-stream",
      size_bytes: content.byteLength,
    });
  }

  await supabase
    .from("conversations")
    .update({
      status: bounce ? "RESOLVED" : "OPEN",
      unread: !bounce,
      last_message_at: new Date().toISOString(),
      last_message_preview: preview(bodyText),
      last_direction: "INBOUND",
    })
    .eq("id", conversationId)
    .neq("status", "SPAM");

  await supabase.from("audit_events").insert({
    actor_type: "API",
    action: "inbox.message_received",
    entity_type: "conversation",
    entity_id: conversationId,
    metadata: { from: senderEmail, channel: "EMAIL" },
  });

  return { status: "stored", conversationId, messageId: message.id as string };
}

type WebFormInput = {
  leadId: string;
  name: string | null;
  email: string;
  locale: string | null;
  topic: string | null;
  message: string;
};

export async function createWebFormConversation(input: WebFormInput) {
  const supabase = createAdminClient();
  const zh = input.locale === "zh";
  const subject = `${zh ? "官网咨询" : "Website inquiry"}${input.topic ? ` · ${input.topic}` : ""}`;

  const { data: conversation, error } = await supabase
    .from("conversations")
    .insert({
      mailbox: "contact",
      subject,
      customer_email: input.email.toLowerCase(),
      customer_name: input.name,
      locale: input.locale,
      lead_id: input.leadId,
      last_message_preview: preview(input.message),
      last_direction: "INBOUND",
    })
    .select("id")
    .single();
  if (error || !conversation) throw new Error(`conversation_insert:${error?.message}`);

  await supabase.from("messages").insert({
    conversation_id: conversation.id,
    direction: "INBOUND",
    channel: "WEB_FORM",
    from_email: input.email.toLowerCase(),
    from_name: input.name,
    subject,
    body_text: input.message,
    delivery_status: "RECEIVED",
  });

  return conversation.id as string;
}
