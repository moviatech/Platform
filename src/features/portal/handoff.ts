import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { CustomerSession } from "@/lib/auth/customer";

type Snapshot = { id?: string; messages?: Array<{ role?: string; text?: string }> };

const preview = (text: string) => text.replace(/\s+/g, " ").slice(0, 140);

export async function recordHandoff(session: CustomerSession, snapshot: Snapshot, locale: string) {
  const supabase = createAdminClient();
  const zh = locale === "zh";
  const subject = zh ? "智能助理转人工" : "Assistant handoff";
  const lines = (snapshot.messages ?? [])
    .filter((message) => (message.role === "user" || message.role === "bot") && message.text)
    .slice(-8)
    .map((message) => `${message.role === "user" ? (zh ? "客户" : "Customer") : zh ? "助理" : "Assistant"}: ${message.text}`);
  const body = lines.join("\n") || (zh ? "客户请求人工客服。" : "Customer asked for a human.");
  const now = new Date().toISOString();
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data: existing } = await supabase
    .from("conversations")
    .select("id")
    .eq("customer_id", session.customerId)
    .eq("subject", subject)
    .in("status", ["OPEN", "PENDING_CUSTOMER"])
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(1);
  let conversationId = existing?.[0]?.id as string | undefined;
  if (conversationId) {
    await supabase
      .from("conversations")
      .update({ status: "OPEN", unread: true, last_message_at: now, last_message_preview: preview(body), last_direction: "INBOUND" })
      .eq("id", conversationId);
  } else {
    const { data: created } = await supabase
      .from("conversations")
      .insert({
        mailbox: "contact",
        subject,
        customer_email: session.email,
        customer_name: session.fullName,
        customer_id: session.customerId,
        locale,
        unread: true,
        last_message_at: now,
        last_message_preview: preview(body),
        last_direction: "INBOUND",
      })
      .select("id")
      .single();
    conversationId = created?.id;
  }
  if (!conversationId) return null;
  await supabase.from("messages").insert({
    conversation_id: conversationId,
    direction: "INBOUND",
    channel: "WEB_FORM",
    from_email: session.email,
    from_name: session.fullName,
    subject,
    body_text: body,
    delivery_status: "RECEIVED",
  });
  if (snapshot.id) await supabase.from("leads").update({ status: "CONVERTED" }).eq("kind", "ASSISTANT").eq("reference", snapshot.id).neq("status", "CONVERTED");
  return conversationId;
}
