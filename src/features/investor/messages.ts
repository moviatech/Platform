import "server-only";
import type { ConversationStatus } from "@/features/inbox/types";
import type { RequestMessage, RequestSummary } from "@/features/portal/request-queries";
import { createAdminClient } from "@/lib/supabase/admin";

const summaryColumns = "id, subject, status, last_message_at, last_message_preview, last_direction, customer_read_at, customer_unread, ended_at, reservation_id, created_at";

export async function listInvestorConversations(investorId: string): Promise<RequestSummary[]> {
  const { data } = await createAdminClient().from("conversations").select(summaryColumns).eq("investor_id", investorId).order("last_message_at", { ascending: false }).limit(100);
  return (data ?? []) as RequestSummary[];
}

export async function getInvestorConversation(investorId: string, id: string): Promise<{ conversation: RequestSummary & { status: ConversationStatus }; messages: RequestMessage[] } | null> {
  const supabase = createAdminClient();
  const { data: conversation } = await supabase.from("conversations").select(summaryColumns).eq("id", id).eq("investor_id", investorId).maybeSingle();
  if (!conversation) return null;
  const { data: messages } = await supabase
    .from("messages")
    .select("id, direction, body_text, from_name, created_at, attachments:message_attachments(id, filename, mime_type)")
    .eq("conversation_id", id)
    .in("direction", ["INBOUND", "OUTBOUND"])
    .order("created_at")
    .limit(300);
  return { conversation: conversation as RequestSummary & { status: ConversationStatus }, messages: (messages ?? []) as unknown as RequestMessage[] };
}
