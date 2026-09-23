"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { isLocale, localeCookie } from "@/i18n/config";
import { audit } from "@/lib/audit";
import { getCustomerSession } from "@/lib/auth/customer";
import { lastStaffResponder, normalizeScore, saveRating } from "@/features/ratings/service";
import { createAdminClient } from "@/lib/supabase/admin";
import { attachToMessage, parseAttachments } from "./attachments";
import { requestSubjects, requestTypes, type RequestState } from "./request-types";

const createInput = z.object({
  type: z.enum(requestTypes),
  trip: z.union([z.literal(""), z.string().regex(/^MV-[A-Z0-9]{6}$/)]),
  message: z.string().trim().min(5).max(3000),
});

const preview = (text: string) => text.replace(/\s+/g, " ").slice(0, 140);

export async function createRequest(_: RequestState, form: FormData): Promise<RequestState> {
  const session = await getCustomerSession();
  if (!session) redirect("/login");
  const parsed = createInput.safeParse({ type: form.get("type"), trip: form.get("trip") ?? "", message: form.get("message") ?? "" });
  if (!parsed.success) return { error: "invalid" };
  const { type, message } = parsed.data;
  const attachments = parseAttachments(form.get("attachments"), session.customerId);
  if (!attachments) return { error: "invalid" };

  const supabase = createAdminClient();
  let trip: string | null = null;
  let reservationId: string | null = null;
  if (parsed.data.trip) {
    const { data } = await supabase.from("reservations").select("id, number").eq("number", parsed.data.trip).eq("customer_id", session.customerId).maybeSingle();
    trip = data?.number ?? null;
    reservationId = data?.id ?? null;
  }
  const stored = (await cookies()).get(localeCookie)?.value;
  const locale = isLocale(stored) ? stored : session.language;
  const subject = `${requestSubjects[type][locale]}${trip ? ` · ${trip}` : ""}`;

  const { data: conversation, error } = await supabase
    .from("conversations")
    .insert({
      mailbox: "contact",
      subject,
      customer_email: session.email,
      customer_name: session.fullName,
      customer_id: session.customerId,
      reservation_id: reservationId,
      locale,
      last_message_preview: preview(message),
      last_direction: "INBOUND",
    })
    .select("id")
    .single();
  if (error || !conversation) return { error: "failed" };
  const { data: inserted } = await supabase
    .from("messages")
    .insert({
      conversation_id: conversation.id,
      direction: "INBOUND",
      channel: "WEB_FORM",
      from_email: session.email,
      from_name: session.fullName,
      subject,
      body_text: message,
      delivery_status: "RECEIVED",
    })
    .select("id")
    .single();
  if (inserted) await attachToMessage(inserted.id, attachments);
  await audit({ actorUserId: session.userId, actorType: "CUSTOMER", action: "customer.request_created", entityType: "conversation", entityId: conversation.id, metadata: { type, trip, by: session.fullName } });
  revalidatePath("/account/messages", "layout");
  redirect(`/messages/${conversation.id}`);
}

const replyInput = z.object({ conversationId: z.uuid(), message: z.string().trim().min(1).max(3000) });

export async function replyRequest(_: RequestState, form: FormData): Promise<RequestState> {
  const session = await getCustomerSession();
  if (!session) redirect("/login");
  const parsed = replyInput.safeParse({ conversationId: form.get("conversationId"), message: form.get("message") ?? "" });
  if (!parsed.success) return { error: "invalid" };
  const { conversationId, message } = parsed.data;
  const attachments = parseAttachments(form.get("attachments"), session.customerId);
  if (!attachments) return { error: "invalid" };

  const supabase = createAdminClient();
  const { data: conversation } = await supabase.from("conversations").select("id, subject, customer_id").eq("id", conversationId).maybeSingle();
  if (!conversation || conversation.customer_id !== session.customerId) return { error: "not_found" };

  const { data: inserted, error } = await supabase
    .from("messages")
    .insert({
      conversation_id: conversationId,
      direction: "INBOUND",
      channel: "WEB_FORM",
      from_email: session.email,
      from_name: session.fullName,
      subject: conversation.subject,
      body_text: message,
      delivery_status: "RECEIVED",
    })
    .select("id")
    .single();
  if (error || !inserted) return { error: "failed" };
  await attachToMessage(inserted.id, attachments);
  await supabase
    .from("conversations")
    .update({ unread: true, status: "OPEN", last_message_at: new Date().toISOString(), last_message_preview: preview(message), last_direction: "INBOUND" })
    .eq("id", conversationId);
  revalidatePath(`/account/messages/${conversationId}`);
  revalidatePath("/account/messages");
  return { ok: true };
}

const conversationInput = z.object({ conversationId: z.uuid() });

export async function endRequest(form: FormData) {
  const session = await getCustomerSession();
  if (!session) redirect("/login");
  const parsed = conversationInput.safeParse({ conversationId: form.get("conversationId") });
  if (!parsed.success) return;
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("conversations")
    .update({ status: "RESOLVED", ended_at: new Date().toISOString(), ended_by: "CUSTOMER", customer_unread: false })
    .eq("id", parsed.data.conversationId)
    .eq("customer_id", session.customerId)
    .neq("status", "RESOLVED")
    .select("id");
  if (data?.length) await audit({ actorUserId: session.userId, actorType: "CUSTOMER", action: "customer.request_ended", entityType: "conversation", entityId: parsed.data.conversationId, metadata: { by: session.fullName } });
  revalidatePath("/account/messages", "layout");
}

export async function rateConversation(_: RequestState, form: FormData): Promise<RequestState> {
  const session = await getCustomerSession();
  if (!session) redirect("/login");
  const parsed = conversationInput.safeParse({ conversationId: form.get("conversationId") });
  const score = normalizeScore(form.get("score"));
  if (!parsed.success || !score) return { error: "invalid" };
  const supabase = createAdminClient();
  const { data: conversation } = await supabase.from("conversations").select("id").eq("id", parsed.data.conversationId).eq("customer_id", session.customerId).maybeSingle();
  if (!conversation) return { error: "invalid" };
  const responder = await lastStaffResponder(conversation.id);
  const comment = String(form.get("comment") ?? "").trim().slice(0, 2000) || null;
  const rating = await saveRating({ kind: "CONVERSATION", score, comment, customerId: session.customerId, conversationId: conversation.id, staffUserId: responder?.userId ?? null, source: "PORTAL" });
  if (!rating) return { error: "failed" };
  await audit({ actorUserId: session.userId, actorType: "CUSTOMER", action: "customer.rating_submitted", entityType: "conversation", entityId: conversation.id, metadata: { score, staff: responder?.userId ?? null } });
  revalidatePath("/account/messages", "layout");
  return { ok: true, score };
}
