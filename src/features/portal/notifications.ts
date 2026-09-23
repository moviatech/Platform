import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

export type PortalNotification = { id: string; subject: string | null; preview: string | null; at: string };

export async function listUnreadConversations(customerId: string): Promise<PortalNotification[]> {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("conversations")
    .select("id, subject, last_message_preview, last_message_at")
    .eq("customer_id", customerId)
    .eq("customer_unread", true)
    .order("last_message_at", { ascending: false })
    .limit(20);
  return (data ?? []).map((row) => ({ id: row.id, subject: row.subject, preview: row.last_message_preview, at: row.last_message_at }));
}
