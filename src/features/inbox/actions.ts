"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { requirePermission } from "@/lib/auth/staff";
import { createAdminClient } from "@/lib/supabase/admin";
import { conversationTargetColumns, postPortalMessage, sendEmailReply } from "./outbound";
import { personaIds } from "./personas";
import { conversationStatuses, replyChannelFor } from "./types";

export type ComposeState = { ok?: boolean; error?: "invalid" | "send_failed" | "not_found"; at?: number };

const composeInput = z.object({
  conversationId: z.uuid(),
  body: z.string().trim().min(1).max(20000),
  mode: z.enum(["reply", "note"]),
  persona: z.enum(personaIds).default("support"),
});

function refresh(conversationId: string) {
  revalidatePath("/ops/inbox", "layout");
  revalidatePath(`/ops/inbox/${conversationId}`);
}

export async function compose(_: ComposeState, form: FormData): Promise<ComposeState> {
  const parsed = composeInput.safeParse({
    conversationId: form.get("conversationId"),
    body: form.get("body"),
    mode: form.get("mode"),
    persona: form.get("persona") ?? "support",
  });
  if (!parsed.success) return { error: "invalid" };
  const { conversationId, body, mode, persona } = parsed.data;

  const session = await requirePermission(mode === "note" ? "inbox.view" : "inbox.reply");
  const supabase = createAdminClient();

  const { data: conversation } = await supabase
    .from("conversations")
    .select(conversationTargetColumns)
    .eq("id", conversationId)
    .maybeSingle();
  if (!conversation) return { error: "not_found" };
  const channel = replyChannelFor(conversation);
  const actor = { userId: session.userId, displayName: session.displayName };

  if (mode === "reply" && (channel !== "EMAIL" || !conversation.customer_email)) {
    await postPortalMessage(conversation, { body, actor, persona });
    await audit({
      actorUserId: session.userId,
      actorType: "STAFF",
      action: "inbox.reply_posted",
      entityType: "conversation",
      entityId: conversationId,
      metadata: { by: session.displayName, channel },
    });
    refresh(conversationId);
    return { ok: true, at: Date.now() };
  }

  if (mode === "note") {
    await supabase.from("messages").insert({
      conversation_id: conversationId,
      direction: "INTERNAL",
      channel: "NOTE",
      from_name: session.displayName,
      body_text: body,
      delivery_status: "RECEIVED",
      sent_by: session.userId,
    });
    await audit({
      actorUserId: session.userId,
      actorType: "STAFF",
      action: "inbox.note_added",
      entityType: "conversation",
      entityId: conversationId,
      metadata: { by: session.displayName },
    });
    refresh(conversationId);
    return { ok: true, at: Date.now() };
  }

  const result = await sendEmailReply(conversation, { body, actor, persona });
  await audit({
    actorUserId: session.userId,
    actorType: "STAFF",
    action: result.sent ? "inbox.reply_sent" : "inbox.reply_failed",
    entityType: "conversation",
    entityId: conversationId,
    metadata: { by: session.displayName, to: conversation.customer_email, mailbox: conversation.mailbox },
  });
  refresh(conversationId);
  return result.sent ? { ok: true, at: Date.now() } : { error: "send_failed", at: Date.now() };
}

const manageInput = z.object({
  conversationId: z.uuid(),
  status: z.enum(conversationStatuses),
  assignedTo: z.union([z.uuid(), z.literal("")]),
  mailbox: z.enum(["contact", "support"]),
});

export type ManageState = { ok?: boolean; error?: boolean };

export async function manageConversation(_: ManageState, form: FormData): Promise<ManageState> {
  const session = await requirePermission("inbox.manage");
  const parsed = manageInput.safeParse({
    conversationId: form.get("conversationId"),
    status: form.get("status"),
    assignedTo: form.get("assignedTo") ?? "",
    mailbox: form.get("mailbox"),
  });
  if (!parsed.success) return { error: true };
  const { conversationId, status, assignedTo, mailbox } = parsed.data;

  const supabase = createAdminClient();
  const { data: before } = await supabase.from("conversations").select("status, assigned_to, mailbox, customer_id").eq("id", conversationId).maybeSingle();
  if (!before) return { error: true };

  const ending = status === "RESOLVED" && before.status !== "RESOLVED" && Boolean(before.customer_id);
  const { error } = await supabase
    .from("conversations")
    .update({ status, assigned_to: assignedTo || null, mailbox, ...(ending ? { ended_at: new Date().toISOString(), ended_by: "STAFF", customer_unread: true } : {}) })
    .eq("id", conversationId);
  if (error) return { error: true };

  if (before.status !== status || before.assigned_to !== (assignedTo || null) || before.mailbox !== mailbox) {
    await audit({
      actorUserId: session.userId,
      actorType: "STAFF",
      action: "inbox.conversation_updated",
      entityType: "conversation",
      entityId: conversationId,
      metadata: { by: session.displayName, from: before.status, to: status, assignedTo: assignedTo || null, mailbox },
    });
  }
  refresh(conversationId);
  return { ok: true };
}

const leadInput = z.object({ leadId: z.uuid() });

export async function startConversationFromLead(form: FormData) {
  const session = await requirePermission("inbox.reply");
  const parsed = leadInput.safeParse({ leadId: form.get("leadId") });
  if (!parsed.success) return;

  const supabase = createAdminClient();
  const { data: existing } = await supabase.from("conversations").select("id").eq("lead_id", parsed.data.leadId).limit(1);
  if (existing?.[0]) redirect(`/inbox/${existing[0].id}`);

  const { data: lead } = await supabase.from("leads").select("id, kind, name, email, locale").eq("id", parsed.data.leadId).maybeSingle();
  if (!lead?.email) return;

  const zh = lead.locale === "zh";
  const subject =
    lead.kind === "BOOKING_REQUEST" ? (zh ? "关于您的 Movia 订车请求" : "About your Movia booking request") : zh ? "来自 Movia 的回复" : "A message from Movia";

  const { data: created } = await supabase
    .from("conversations")
    .insert({
      mailbox: "contact",
      subject,
      customer_email: String(lead.email).toLowerCase(),
      customer_name: lead.name,
      locale: lead.locale,
      lead_id: lead.id,
      unread: false,
    })
    .select("id")
    .single();
  if (!created) return;
  await supabase.from("leads").update({ status: "CONVERTED" }).eq("id", lead.id);

  await audit({
    actorUserId: session.userId,
    actorType: "STAFF",
    action: "inbox.conversation_started",
    entityType: "conversation",
    entityId: created.id,
    metadata: { by: session.displayName, leadId: lead.id },
  });
  redirect(`/inbox/${created.id}`);
}
