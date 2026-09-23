import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { listCustomerNotifications, renderParams, type Notification } from "@/features/notifications/center";

export type PortalNotification = { id: string; subject: string | null; preview: string | null; at: string; href: string; unread: boolean };

export function portalNotificationTitle(item: Notification, locale: string, label: (kind: string) => string) {
  const params = renderParams(item.params, locale);
  const range = params.from && params.to ? `${params.from} - ${params.to}` : "";
  return [label(item.kind.replace(/\./g, "_")), range, params.vehicle].filter(Boolean).join(" · ");
}

export async function listPortalNotifications(customerId: string, locale: string, label: (kind: string) => string): Promise<PortalNotification[]> {
  const rows = await listCustomerNotifications(customerId);
  return rows.map((item) => ({
    id: item.id,
    subject: portalNotificationTitle(item, locale, label),
    preview: null,
    at: item.created_at,
    href: `/notifications/${item.id}`,
    unread: !item.read_at,
  }));
}

export async function listUnreadConversations(customerId: string): Promise<PortalNotification[]> {
  const { data } = await createAdminClient()
    .from("conversations")
    .select("id, subject, last_message_preview, last_message_at")
    .eq("customer_id", customerId)
    .eq("customer_unread", true)
    .order("last_message_at", { ascending: false })
    .limit(20);
  return (data ?? []).map((row) => ({ id: row.id, subject: row.subject, preview: row.last_message_preview, at: row.last_message_at, href: `/messages/${row.id}`, unread: true }));
}
