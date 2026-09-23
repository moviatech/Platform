import "server-only";
import { sendEmail } from "@/lib/email";
import { notifyCustomer } from "./center";
import { renderEmail, type EmailBlock } from "@/lib/email/template";
import { readPreferences } from "@/features/portal/preferences";
import { rootDomain } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatDate, formatFullDateTime, formatMoney } from "@/lib/utils/format";

export type ReservationEmailKind = "requested" | "confirmed" | "cancelled" | "updated" | "returnSoon" | "overdue";

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
  location: { name: string; name_zh: string | null; address: string | null; support_phone: string | null; support_email: string | null; support_wechat: string | null; support_hours: string | null; support_hours_zh: string | null } | null;
};

const copy = {
  zh: {
    requested: { subject: (n: string) => `已收到您的订车请求 · ${n}`, title: "已收到您的订车请求", intro: "我们会尽快确认车辆并回复您。确认后您会收到另一封邮件。", cta: "查看行程" },
    confirmed: { subject: (n: string) => `订单已确认 · ${n}`, title: "您的订单已确认", intro: "取车前请在行程中心完成驾照核验与合同签署，押金将在取车时以信用卡预授权办理。", cta: "打开行程中心" },
    cancelled: { subject: (n: string) => `订单已取消 · ${n}`, title: "您的订单已取消", intro: "如有退款，通常在 5–10 个工作日内退回原支付卡。有任何问题请直接回复本邮件。", cta: "查看行程" },
    updated: { subject: (n: string) => `订单已更新 · ${n}`, title: "您的订单已更新", intro: "以下是更新后的行程信息。如有疑问请直接回复本邮件。", cta: "查看行程" },
    returnSoon: { subject: (n: string) => `还车提醒 · ${n}`, title: "明天就要还车了", intro: "请按约定时间把车开回取车门店。想多开几天，点下方「申请续租」（以库存为准）。还车前请把电量充到 80% 以上，带齐钥匙卡和充电器，停好后拍几张车况照片。", cta: "查看行程" },
    overdue: { subject: (n: string) => `车辆已超过约定还车时间 · ${n}`, title: "车辆已超过约定还车时间", intro: "我们还没有收到车。从约定还车时间起，逾期 5 小时以内按小时计费，超过 5 小时按一天计费。如需继续使用，请立即申请续租；如已在路上，到店即可。", cta: "查看行程" },
    extend: "申请续租",
    rows: { vehicle: "车型", pickup: "取车", return: "还车", location: "地点", total: "合计", hold: "取车时预授权", contact: "门店联系" },
  },
  en: {
    requested: { subject: (n: string) => `Booking request received · ${n}`, title: "We received your booking request", intro: "We will confirm the vehicle shortly and email you again once it is confirmed.", cta: "View trip" },
    confirmed: { subject: (n: string) => `Reservation confirmed · ${n}`, title: "Your reservation is confirmed", intro: "Before pickup, please complete license verification and sign the rental agreement in My Trips. The security hold is placed on your credit card at pickup.", cta: "Open My Trips" },
    cancelled: { subject: (n: string) => `Reservation cancelled · ${n}`, title: "Your reservation has been cancelled", intro: "Any refund is returned to the original card, usually within 5–10 business days. Reply to this email with any questions.", cta: "View trip" },
    updated: { subject: (n: string) => `Reservation updated · ${n}`, title: "Your reservation has been updated", intro: "Here are the updated trip details. Reply to this email with any questions.", cta: "View trip" },
    returnSoon: { subject: (n: string) => `Return reminder · ${n}`, title: "Your return is tomorrow", intro: "Please bring the car back to the pickup location at the scheduled time. Need more days? Tap Request extension below (subject to availability). Before returning, charge to 80% or above, bring the key card and charger, and take a few photos once parked.", cta: "View trip" },
    overdue: { subject: (n: string) => `Vehicle past scheduled return · ${n}`, title: "Your vehicle is past its scheduled return", intro: "We have not received the car yet. From the scheduled return time, up to 5 hours late is billed by the hour and more than 5 hours is billed as a full day. Need it longer? Request an extension now; if you are on your way, just come to the location.", cta: "View trip" },
    extend: "Request extension",
    rows: { vehicle: "Vehicle", pickup: "Pickup", return: "Return", location: "Location", total: "Total", hold: "Hold at pickup", contact: "Location contact" },
  },
};

export async function notifyReservation(kind: ReservationEmailKind, reservationId: string, extra: { feeCents?: number; refundedCents?: number; dedupeKey?: string } = {}) {
  const { data } = await createAdminClient()
    .from("reservations")
    .select(
      "id, number, customer_id, pickup_at, return_at, rental_days, total_cents, security_hold_cents, rate_plan, quote_snapshot, customer:customers(full_name, email, preferred_language, preferences), vehicle_class:vehicle_classes(name, name_zh), location:locations!reservations_pickup_location_id_fkey(name, name_zh, address, support_phone, support_email, support_wechat, support_hours, support_hours_zh)",
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
  const support = [row.location?.support_phone, row.location?.support_email, row.location?.support_wechat ? `WeChat ${row.location.support_wechat}` : null, locale === "zh" ? row.location?.support_hours_zh || row.location?.support_hours : row.location?.support_hours].filter(Boolean).join(" · ");

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
        ...(support ? [[text.rows.contact, support] as [string, string]] : []),
      ],
    },
    { type: "button", label: section.cta, href: `https://account.${rootDomain}/trips/${row.number}` },
  ];
  if (kind === "returnSoon" || kind === "overdue") blocks.push({ type: "button", label: text.extend, href: `https://account.${rootDomain}/trips/${row.number}/modify?action=extend` });
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
  const rendered = renderEmail({ preheader: `${row.number} · ${vehicle ?? ""}`, title: section.title, blocks, footer: support ? `Movia Technologies · ${locale === "zh" ? (row.location?.name_zh ?? row.location?.name) : row.location?.name} · ${support}` : undefined });
  return sendEmail({ to: row.customer.email, subject: section.subject(row.number), text: rendered.text, html: rendered.html });
}
