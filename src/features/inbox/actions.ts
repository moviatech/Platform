"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { requirePermission } from "@/lib/auth/staff";
import { requireScope, scopeAllows } from "@/lib/auth/scope";
import { createAdminClient } from "@/lib/supabase/admin";
import { conversationTargetColumns, postPortalMessage, sendEmailReply } from "./outbound";
import { personaIds } from "./personas";
import { composeReply } from "./ai";
import { AiError } from "@/lib/ai/openai";
import { conversationStatuses, replyChannelFor, type ConversationStatus, type Mailbox } from "./types";

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
  await requireScope(session, { conversation: conversationId });
  const supabase = createAdminClient();

  const { data: conversation } = await supabase
    .from("conversations")
    .select(conversationTargetColumns)
    .eq("id", conversationId)
    .maybeSingle();
  if (!conversation) return { error: "not_found" };
  const channel = form.get("viaEmail") === "1" && conversation.customer_email ? "EMAIL" : replyChannelFor(conversation);
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

type ConversationChange = { status?: ConversationStatus; assignedTo?: string | null; mailbox?: Mailbox };

async function applyConversationChange(supabase: ReturnType<typeof createAdminClient>, id: string, change: ConversationChange) {
  const { data: before } = await supabase.from("conversations").select("status, assigned_to, mailbox, customer_id, location_id").eq("id", id).maybeSingle();
  if (!before) return null;
  const status = (change.status ?? before.status) as ConversationStatus;
  const assignedTo = change.assignedTo === undefined ? (before.assigned_to as string | null) : change.assignedTo;
  const mailbox = (change.mailbox ?? before.mailbox) as Mailbox;
  const ending = status === "RESOLVED" && before.status !== "RESOLVED" && Boolean(before.customer_id);
  const { error } = await supabase
    .from("conversations")
    .update({ status, assigned_to: assignedTo, mailbox, ...(ending ? { ended_at: new Date().toISOString(), ended_by: "STAFF", customer_unread: true } : {}) })
    .eq("id", id);
  if (error) return null;
  if (assignedTo && assignedTo !== before.assigned_to) {
    const { data: assigneeLocations } = await supabase.from("staff_locations").select("location_id").eq("user_id", assignedTo);
    const ids = (assigneeLocations ?? []).map((row) => row.location_id as string);
    if (ids.length && !(before.location_id && ids.includes(before.location_id))) await supabase.from("conversations").update({ location_id: ids[0] }).eq("id", id);
  }
  return { before, status, assignedTo, mailbox };
}

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
  await requireScope(session, { conversation: conversationId });

  const supabase = createAdminClient();
  const result = await applyConversationChange(supabase, conversationId, { status, assignedTo: assignedTo || null, mailbox });
  if (!result) return { error: true };
  const { before } = result;

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

const bulkInput = z.object({
  ids: z.array(z.uuid()).min(1).max(200),
  status: z.union([z.enum(conversationStatuses), z.literal("")]),
  assignedTo: z.union([z.uuid(), z.literal("none"), z.literal("")]),
});

export async function bulkConversations(form: FormData) {
  const session = await requirePermission("inbox.manage");
  const parsed = bulkInput.safeParse({ ids: form.getAll("ids").map(String), status: form.get("status") ?? "", assignedTo: form.get("assignedTo") ?? "" });
  if (!parsed.success) return { error: true };
  const { status, assignedTo } = parsed.data;
  if (!status && !assignedTo) return { error: true };
  const supabase = createAdminClient();
  const allowed = (await Promise.all(parsed.data.ids.map(async (id) => ((await scopeAllows(session, { conversation: id })) ? id : null)))).filter((id): id is string => Boolean(id));
  const change: ConversationChange = { ...(status ? { status } : {}), ...(assignedTo ? { assignedTo: assignedTo === "none" ? null : assignedTo } : {}) };
  let count = 0;
  for (const id of allowed) if (await applyConversationChange(supabase, id, change)) count += 1;
  await audit({ actorUserId: session.userId, actorType: "STAFF", action: "inbox.bulk_updated", entityType: "conversation", entityId: allowed[0] ?? parsed.data.ids[0], metadata: { by: session.displayName, count, status: status || null, assignedTo: assignedTo || null } });
  revalidatePath("/ops/inbox", "layout");
  return { ok: true, count };
}

const noteInput = z.object({ conversationId: z.uuid(), body: z.string().trim().min(1).max(20000) });

export async function addNote(form: FormData) {
  const session = await requirePermission("inbox.view");
  const parsed = noteInput.safeParse({ conversationId: form.get("conversationId"), body: form.get("body") ?? "" });
  if (!parsed.success) return { error: true };
  await requireScope(session, { conversation: parsed.data.conversationId });
  const { error } = await createAdminClient().from("messages").insert({
    conversation_id: parsed.data.conversationId,
    direction: "INTERNAL",
    channel: "NOTE",
    from_name: session.displayName,
    body_text: parsed.data.body,
    delivery_status: "RECEIVED",
    sent_by: session.userId,
  });
  if (error) return { error: true };
  await audit({ actorUserId: session.userId, actorType: "STAFF", action: "inbox.note_added", entityType: "conversation", entityId: parsed.data.conversationId, metadata: { by: session.displayName } });
  refresh(parsed.data.conversationId);
  return { ok: true };
}

export async function updateNote(form: FormData) {
  const session = await requirePermission("inbox.view");
  const parsed = noteInput.extend({ id: z.uuid() }).safeParse({ conversationId: form.get("conversationId"), id: form.get("id"), body: form.get("body") ?? "" });
  if (!parsed.success) return { error: true };
  await requireScope(session, { conversation: parsed.data.conversationId });
  const { error } = await createAdminClient().from("messages").update({ body_text: parsed.data.body }).eq("id", parsed.data.id).eq("conversation_id", parsed.data.conversationId).eq("direction", "INTERNAL");
  if (error) return { error: true };
  await audit({ actorUserId: session.userId, actorType: "STAFF", action: "inbox.note_updated", entityType: "message", entityId: parsed.data.id, metadata: { by: session.displayName } });
  refresh(parsed.data.conversationId);
  return { ok: true };
}

export async function deleteNote(form: FormData) {
  const session = await requirePermission("inbox.view");
  const parsed = z.object({ conversationId: z.uuid(), id: z.uuid() }).safeParse({ conversationId: form.get("conversationId"), id: form.get("id") });
  if (!parsed.success) return { error: true };
  await requireScope(session, { conversation: parsed.data.conversationId });
  const { error } = await createAdminClient().from("messages").delete().eq("id", parsed.data.id).eq("conversation_id", parsed.data.conversationId).eq("direction", "INTERNAL");
  if (error) return { error: true };
  await audit({ actorUserId: session.userId, actorType: "STAFF", action: "inbox.note_deleted", entityType: "message", entityId: parsed.data.id, metadata: { by: session.displayName } });
  refresh(parsed.data.conversationId);
  return { ok: true };
}

const polishInput = z.object({ conversationId: z.uuid(), draft: z.string().trim().max(20000).default(""), language: z.enum(["zh", "en"]), persona: z.enum(personaIds).default("support"), mode: z.enum(["polish", "draft"]).default("polish") });

export async function polishReply(form: FormData): Promise<{ text?: string; error?: string }> {
  const parsed = polishInput.safeParse({ conversationId: form.get("conversationId"), draft: form.get("draft") ?? "", language: form.get("language"), persona: form.get("persona") ?? "support", mode: form.get("mode") ?? "polish" });
  if (!parsed.success || (parsed.data.mode === "polish" && !parsed.data.draft)) return { error: "invalid" };
  const session = await requirePermission("inbox.reply");
  await requireScope(session, { conversation: parsed.data.conversationId });
  try {
    const text = await composeReply(parsed.data);
    return text ? { text } : { error: "not_found" };
  } catch (error) {
    return { error: error instanceof AiError ? error.message.slice(0, 160) : "failed" };
  }
}

const leadInput = z.object({ leadId: z.uuid() });

export async function startConversationFromLead(form: FormData) {
  const session = await requirePermission("inbox.reply");
  if (session.locationIds) return;
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
