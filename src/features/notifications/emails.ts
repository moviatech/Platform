import "server-only";
import { sendEmail, sesMessageIdHeader } from "@/lib/email";
import { renderEmail, type EmailBlock } from "@/lib/email/template";
import { readPreferences } from "@/features/portal/preferences";
import { rootDomain } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatFullDateTime, formatMoney } from "@/lib/utils/format";

export type ReservationEmailKind = "requested" | "confirmed" | "cancelled" | "updated";

type Row = {
  id: string;
  number: string;
  customer_id: string;
  pickup_at: string;
  return_at: string;
  rental_days: number;
  total_cents: number;
  security_hold_cents: number;
  rate_plan: "PAY_NOW" | "PAY_LATER";
  quote_snapshot: { depositCents?: number } | null;
  customer: { full_name: string; email: string | null; preferred_language: string; preferences: unknown } | null;
  vehicle_class: { name: string; name_zh: string | null } | null;
  location: { name: string; name_zh: string | null; address: string | null } | null;
};

const copy = {
  zh: {
    requested: { subject: (n: string) => `已收到您的订车请求 · ${n}`, title: "已收到您的订车请求", intro: "我们会尽快确认车辆并回复您。确认后您会收到另一封邮件。", cta: "查看行程" },
    confirmed: { subject: (n: string) => `订单已确认 · ${n}`, title: "您的订单已确认", intro: "取车前请在行程中心完成驾照核验与合同签署，押金将在取车时以信用卡预授权办理。", cta: "打开行程中心" },
    cancelled: { subject: (n: string) => `订单已取消 · ${n}`, title: "您的订单已取消", intro: "如有退款，通常在 5–10 个工作日内退回原支付卡。有任何问题请直接回复本邮件。", cta: "查看行程" },
    updated: { subject: (n: string) => `订单已更新 · ${n}`, title: "您的订单已更新", intro: "以下是更新后的行程信息。如有疑问请直接回复本邮件。", cta: "查看行程" },
    rows: { vehicle: "车型", pickup: "取车", return: "还车", location: "地点", total: "合计", hold: "取车时预授权" },
  },
  en: {
    requested: { subject: (n: string) => `Booking request received · ${n}`, title: "We received your booking request", intro: "We will confirm the vehicle shortly and email you again once it is confirmed.", cta: "View trip" },
    confirmed: { subject: (n: string) => `Reservation confirmed · ${n}`, title: "Your reservation is confirmed", intro: "Before pickup, please complete license verification and sign the rental agreement in My Trips. The security hold is placed on your credit card at pickup.", cta: "Open My Trips" },
    cancelled: { subject: (n: string) => `Reservation cancelled · ${n}`, title: "Your reservation has been cancelled", intro: "Any refund is returned to the original card, usually within 5–10 business days. Reply to this email with any questions.", cta: "View trip" },
    updated: { subject: (n: string) => `Reservation updated · ${n}`, title: "Your reservation has been updated", intro: "Here are the updated trip details. Reply to this email with any questions.", cta: "View trip" },
    rows: { vehicle: "Vehicle", pickup: "Pickup", return: "Return", location: "Location", total: "Total", hold: "Hold at pickup" },
  },
};

export async function notifyReservation(kind: ReservationEmailKind, reservationId: string) {
  const { data } = await createAdminClient()
    .from("reservations")
    .select(
      "id, number, customer_id, pickup_at, return_at, rental_days, total_cents, security_hold_cents, rate_plan, quote_snapshot, customer:customers(full_name, email, preferred_language, preferences), vehicle_class:vehicle_classes(name, name_zh), location:locations!reservations_pickup_location_id_fkey(name, name_zh, address)",
    )
    .eq("id", reservationId)
    .maybeSingle();
  const row = data as unknown as Row | null;
  if (!row?.customer?.email) return { sent: false as const };

  const locale = row.customer.preferred_language === "zh" ? "zh" : "en";
  if (kind === "updated") {
    const prefs = readPreferences(row.customer.preferences);
    if (!prefs.notifications || !prefs.updates) return { sent: false as const };
  }
  const text = copy[locale];
  const section = text[kind];
  const vehicle = locale === "zh" ? (row.vehicle_class?.name_zh ?? row.vehicle_class?.name) : row.vehicle_class?.name;
  const location = `${locale === "zh" ? (row.location?.name_zh ?? row.location?.name) : row.location?.name}${row.location?.address ? ` · ${row.location.address}` : ""}`;
  const hold = row.security_hold_cents + (row.quote_snapshot?.depositCents ?? 0);

  const blocks: EmailBlock[] = [
    { type: "paragraph", text: section.intro },
    {
      type: "rows",
      rows: [
        [text.rows.vehicle, vehicle ?? ""],
        [text.rows.pickup, formatFullDateTime(row.pickup_at, locale)],
        [text.rows.return, formatFullDateTime(row.return_at, locale)],
        [text.rows.location, location],
        [text.rows.total, formatMoney(row.total_cents)],
        ...(kind === "cancelled" ? [] : [[text.rows.hold, formatMoney(hold)] as [string, string]]),
      ],
    },
    { type: "button", label: section.cta, href: `https://account.${rootDomain}/trips/${row.number}` },
  ];
  const rendered = renderEmail({ preheader: `${row.number} · ${vehicle ?? ""}`, title: section.title, blocks });
  const result = await sendEmail({ to: row.customer.email, subject: section.subject(row.number), text: rendered.text, html: rendered.html });
  if (result.sent) await recordNotification(row, section.subject(row.number), rendered.text, result.messageId, locale, vehicle ?? "").catch(() => undefined);
  return result;
}

async function recordNotification(row: Row, subject: string, body: string, messageId: string, locale: string, vehicle: string) {
  const supabase = createAdminClient();
  const email = (row.customer?.email ?? "").toLowerCase();
  if (!email) return;
  const previewText = body.replace(/\s+/g, " ").slice(0, 140);
  const now = new Date().toISOString();
  const { data: existing } = await supabase.from("conversations").select("id").eq("reservation_id", row.id).limit(1);
  let conversationId = existing?.[0]?.id as string | undefined;
  if (conversationId) {
    await supabase.from("conversations").update({ last_message_at: now, last_message_preview: previewText, last_direction: "OUTBOUND" }).eq("id", conversationId);
  } else {
    const { data: created } = await supabase
      .from("conversations")
      .insert({
        mailbox: "contact",
        subject: `${row.number} · ${vehicle}`,
        customer_email: email,
        customer_name: row.customer?.full_name ?? null,
        customer_id: row.customer_id,
        reservation_id: row.id,
        locale,
        status: "RESOLVED",
        unread: false,
        last_message_at: now,
        last_message_preview: previewText,
        last_direction: "OUTBOUND",
      })
      .select("id")
      .single();
    conversationId = created?.id;
  }
  if (!conversationId) return;
  await supabase.from("messages").insert({
    conversation_id: conversationId,
    direction: "OUTBOUND",
    channel: "EMAIL",
    from_email: `contact@${rootDomain}`,
    from_name: "Movia",
    to_email: email,
    subject,
    body_text: body,
    message_id_header: messageId ? sesMessageIdHeader(messageId) : null,
    provider_message_id: messageId || null,
    delivery_status: "SENT",
  });
}
