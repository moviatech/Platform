import "server-only";
import type { ConversationStatus } from "@/features/inbox/types";
import { createAdminClient } from "@/lib/supabase/admin";
import type { RequestMessage } from "./request-queries";

export type LiveThreadPayload = { status: ConversationStatus; ended: boolean; messages: RequestMessage[] };

export async function listNewMessages(customerId: string, conversationId: string, afterId: string | null): Promise<LiveThreadPayload | null> {
  const supabase = createAdminClient();
  const { data: conversation } = await supabase.from("conversations").select("status, ended_at").eq("id", conversationId).eq("customer_id", customerId).maybeSingle();
  if (!conversation) return null;
  const payload: LiveThreadPayload = { status: conversation.status as ConversationStatus, ended: Boolean(conversation.ended_at), messages: [] };
  let query = supabase
    .from("messages")
    .select("id, direction, body_text, from_name, created_at, attachments:message_attachments(id, filename, mime_type)")
    .eq("conversation_id", conversationId)
    .in("direction", ["INBOUND", "OUTBOUND"])
    .order("created_at")
    .limit(100);
  if (afterId) {
    const { data: anchor } = await supabase.from("messages").select("created_at").eq("id", afterId).eq("conversation_id", conversationId).maybeSingle();
    if (!anchor) return payload;
    query = query.gt("created_at", anchor.created_at);
  }
  const { data } = await query;
  payload.messages = (data ?? []) as unknown as RequestMessage[];
  if (payload.messages.some((message) => message.direction === "OUTBOUND")) {
    await supabase.from("conversations").update({ customer_read_at: new Date().toISOString(), customer_unread: false }).eq("id", conversationId);
  }
  return payload;
}
