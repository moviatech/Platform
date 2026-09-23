import "server-only";
import { listInvestorNotifications, renderParams } from "@/features/notifications/center";
import type { PortalNotification } from "@/features/portal/notifications";
import { createAdminClient } from "@/lib/supabase/admin";

export async function listInvestorBell(investorId: string, locale: string, label: (kind: string, params: Record<string, string>) => string): Promise<PortalNotification[]> {
  const [rows, { data: conversations }] = await Promise.all([
    listInvestorNotifications(investorId),
    createAdminClient().from("conversations").select("id, subject, last_message_preview, last_message_at").eq("investor_id", investorId).eq("customer_unread", true).order("last_message_at", { ascending: false }).limit(20),
  ]);
  const notifications = rows.map((item) => ({ id: item.id, subject: label(item.kind.replace(/\./g, "_"), renderParams(item.params, locale)), preview: null, at: item.created_at, href: `/notifications/${item.id}`, unread: !item.read_at }));
  const threads = (conversations ?? []).map((row) => ({ id: row.id, subject: row.subject, preview: row.last_message_preview, at: row.last_message_at, href: `/messages/${row.id}`, unread: true }));
  return [...notifications, ...threads].filter((item) => item.unread).sort((a, b) => b.at.localeCompare(a.at));
}
