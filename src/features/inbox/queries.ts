import "server-only";
import { createClient } from "@/lib/supabase/server";
import { conversationStatuses, type Attachment, type Conversation, type ConversationStatus, type Message } from "./types";

const conversationColumns =
  "id, token, mailbox, subject, customer_email, customer_name, customer_id, locale, status, unread, assigned_to, lead_id, reservation_id, reservation:reservations(id, number), last_message_at, last_message_preview, last_direction, created_at";

export type InboxFilters = { status?: string; q?: string; mine?: string };

export async function listConversations(filters: InboxFilters, userId: string, limit = 80): Promise<Conversation[]> {
  const supabase = await createClient();
  let query = supabase.from("conversations").select(conversationColumns).order("last_message_at", { ascending: false }).limit(limit);

  if ((conversationStatuses as readonly string[]).includes(filters.status ?? "")) {
    query = query.eq("status", filters.status as ConversationStatus);
  } else if (filters.status !== "all") {
    query = query.eq("status", "OPEN");
  }
  if (filters.mine === "1") query = query.eq("assigned_to", userId);

  const term = (filters.q ?? "").trim().replace(/[%_,()]/g, " ").slice(0, 80);
  if (term) {
    const reference = (filters.q ?? "").trim().slice(0, 80).replace(/[%_\\]/g, "\\$&");
    const { data: leads } = await supabase.from("leads").select("id").ilike("reference", `%${reference}%`).limit(50);
    const parts = [`customer_email.ilike.%${term}%`, `customer_name.ilike.%${term}%`, `subject.ilike.%${term}%`];
    if (/^[0-9a-f]{20}$/i.test(term)) parts.push(`token.ilike.${term}`);
    if (leads?.length) parts.push(`lead_id.in.(${leads.map((row) => row.id).join(",")})`);
    query = query.or(parts.join(","));
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as Conversation[];
}

export async function getConversation(id: string): Promise<Conversation | null> {
  const supabase = await createClient();
  const { data } = await supabase.from("conversations").select(conversationColumns).eq("id", id).maybeSingle();
  return (data as Conversation | null) ?? null;
}

export async function listMessages(conversationId: string): Promise<Message[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("messages")
    .select(
      "id, conversation_id, direction, channel, from_email, from_name, to_email, subject, body_text, delivery_status, delivery_error, sent_by, created_at, attachments:message_attachments(id, message_id, filename, mime_type, size_bytes)",
    )
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true })
    .limit(500);
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => ({ ...row, attachments: (row.attachments ?? []) as Attachment[] })) as Message[];
}

export async function listOtherConversations(email: string, excludeId: string): Promise<Conversation[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("conversations")
    .select(conversationColumns)
    .eq("customer_email", email)
    .neq("id", excludeId)
    .order("last_message_at", { ascending: false })
    .limit(5);
  return (data ?? []) as unknown as Conversation[];
}

export async function countOpenConversations() {
  const supabase = await createClient();
  const { count } = await supabase.from("conversations").select("id", { count: "exact", head: true }).eq("status", "OPEN");
  return count ?? 0;
}

export async function listStaffDirectory() {
  const supabase = await createClient();
  const { data } = await supabase.from("staff_members").select("user_id, display_name").eq("active", true).order("display_name");
  return (data ?? []) as Array<{ user_id: string; display_name: string }>;
}

export async function findConversationForLead(leadId: string) {
  const supabase = await createClient();
  const { data } = await supabase.from("conversations").select("id").eq("lead_id", leadId).order("created_at", { ascending: false }).limit(1);
  return (data?.[0]?.id as string | undefined) ?? null;
}
