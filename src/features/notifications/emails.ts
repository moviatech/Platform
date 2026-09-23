import "server-only";
import { sendEmail } from "@/lib/email";
import { notifyCustomer } from "./center";
import { renderEmail, type EmailBlock } from "@/lib/email/template";
import { readPreferences } from "@/features/portal/preferences";
import { rootDomain } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatDate, formatFullDateTime, formatMoney } from "@/lib/utils/format";

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

export async function notifyReservation(kind: ReservationEmailKind, reservationId: string, extra: { feeCents?: number; refundedCents?: number; dedupeKey?: string } = {}) {
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
        [text.rows.pickup, formatFullDateTime(row.pickup_at)],
        [text.rows.return, formatFullDateTime(row.return_at)],
        [text.rows.location, location],
        [text.rows.total, formatMoney(row.total_cents)],
        ...(kind === "cancelled" ? [] : [[text.rows.hold, formatMoney(hold)] as [string, string]]),
      ],
    },
    { type: "button", label: section.cta, href: `https://account.${rootDomain}/trips/${row.number}` },
  ];
  if (kind === "cancelled" && ((extra.feeCents ?? 0) > 0 || (extra.refundedCents ?? 0) > 0)) {
    const fee = extra.feeCents ?? 0;
    const refunded = extra.refundedCents ?? 0;
    const note =
      locale === "zh"
        ? fee > 0
          ? `本次取消不在免费取消期内，按租赁协议收取取消费 ${formatMoney(fee)}${refunded > 0 ? `，其余 ${formatMoney(refunded)} 已退回原支付方式` : ""}。退款到账时间以发卡行为准，一般 3–7 个工作日。`
          : `已付款项 ${formatMoney(refunded)} 已全额退回原支付方式，到账时间以发卡行为准，一般 3–7 个工作日。`
        : fee > 0
          ? `This cancellation falls outside the free cancellation window, so a ${formatMoney(fee)} cancellation fee applies under the rental agreement${refunded > 0 ? ` and the remaining ${formatMoney(refunded)} has been refunded to your original payment method` : ""}. Refunds usually post within 3–7 business days.`
          : `Your payment of ${formatMoney(refunded)} has been refunded in full to your original payment method. Refunds usually post within 3–7 business days.`;
    blocks.splice(1, 0, { type: "paragraph", text: note });
  }
  if (row.customer_id) {
    const inserted = await notifyCustomer(row.customer_id, {
      kind: `reservation.${kind}`,
      reservationId: row.id,
      href: `/trips/${row.number}`,
      dedupeKey: extra.dedupeKey ?? null,
      params: { number: row.number, vehicle: { zh: row.vehicle_class?.name_zh ?? row.vehicle_class?.name ?? "", en: row.vehicle_class?.name ?? "" }, from: formatDate(row.pickup_at), to: formatDate(row.return_at), total: formatMoney(row.total_cents) },
    });
    if (extra.dedupeKey && !inserted) return { sent: false as const };
  }
  const rendered = renderEmail({ preheader: `${row.number} · ${vehicle ?? ""}`, title: section.title, blocks });
  return sendEmail({ to: row.customer.email, subject: section.subject(row.number), text: rendered.text, html: rendered.html });
}
