import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ConversationStatus } from "@/features/inbox/types";

export type RequestSummary = {
  id: string;
  subject: string | null;
  status: ConversationStatus;
  last_message_at: string;
  last_message_preview: string | null;
  last_direction: "INBOUND" | "OUTBOUND" | "INTERNAL" | null;
  customer_read_at: string | null;
  customer_unread: boolean;
  ended_at: string | null;
  reservation_id: string | null;
  created_at: string;
};

export type RequestMessage = {
  id: string;
  direction: "INBOUND" | "OUTBOUND";
  body_text: string;
  from_name: string | null;
  created_at: string;
  attachments: Array<{ id: string; filename: string; mime_type: string }>;
};

export async function listRequests(customerId: string): Promise<RequestSummary[]> {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("conversations")
    .select("id, subject, status, last_message_at, last_message_preview, last_direction, customer_read_at, customer_unread, ended_at, reservation_id, created_at")
    .eq("customer_id", customerId)
    .order("last_message_at", { ascending: false })
    .limit(50);
  return (data ?? []) as RequestSummary[];
}

export async function getRequest(customerId: string, id: string): Promise<{ request: RequestSummary; messages: RequestMessage[] } | null> {
  const supabase = createAdminClient();
  const { data: request } = await supabase
    .from("conversations")
    .select("id, subject, status, last_message_at, last_message_preview, last_direction, customer_read_at, customer_unread, ended_at, reservation_id, created_at")
    .eq("id", id)
    .eq("customer_id", customerId)
    .maybeSingle();
  if (!request) return null;
  const { data: messages } = await supabase
    .from("messages")
    .select("id, direction, body_text, from_name, created_at, attachments:message_attachments(id, filename, mime_type)")
    .eq("conversation_id", id)
    .neq("direction", "INTERNAL")
    .order("created_at");
  return { request: request as RequestSummary, messages: (messages ?? []) as unknown as RequestMessage[] };
}
