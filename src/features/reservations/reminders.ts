import "server-only";
import { loadActiveConfig } from "@/features/booking/service";
import { notifyReservation } from "@/features/notifications/emails";
import { createAdminClient } from "@/lib/supabase/admin";

const dayMs = 24 * 60 * 60 * 1000;

export async function sendReturnReminders() {
  const supabase = createAdminClient();
  const now = Date.now();
  const grace = (await loadActiveConfig().catch(() => null))?.data.returnGraceMinutes ?? 29;
  const result = { reminders: 0, overdue: 0 };

  const { data: soon } = await supabase
    .from("reservations")
    .select("id")
    .eq("status", "ACTIVE")
    .is("return_reminder_at", null)
    .gt("return_at", new Date(now).toISOString())
    .lte("return_at", new Date(now + dayMs).toISOString())
    .limit(50);
  for (const row of soon ?? []) {
    await supabase.from("reservations").update({ return_reminder_at: new Date().toISOString() }).eq("id", row.id);
    const sent = await notifyReservation("returnSoon", row.id, { dedupeKey: `return_soon:${row.id}` }).catch(() => ({ sent: false as const }));
    if (sent.sent) result.reminders += 1;
  }

  const { data: overdue } = await supabase
    .from("reservations")
    .select("id")
    .eq("status", "ACTIVE")
    .is("overdue_notice_at", null)
    .lt("return_at", new Date(now - grace * 60000).toISOString())
    .gt("return_at", new Date(now - 7 * dayMs).toISOString())
    .limit(50);
  for (const row of overdue ?? []) {
    await supabase.from("reservations").update({ overdue_notice_at: new Date().toISOString() }).eq("id", row.id);
    const sent = await notifyReservation("overdue", row.id, { dedupeKey: `overdue:${row.id}` }).catch(() => ({ sent: false as const }));
    if (sent.sent) result.overdue += 1;
  }
  return result;
}
