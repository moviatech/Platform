import "server-only";
import { sendEmail } from "@/lib/email";
import { renderEmail } from "@/lib/email/template";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatFullDateTime, formatMoney } from "@/lib/utils/format";
import { payToken, payUrl } from "./pay-link";

type Row = {
  id: string;
  number: string;
  customer_id: string;
  pickup_at: string;
  return_at: string;
  total_cents: number;
  customer: { email: string | null; preferred_language: string | null } | null;
  vehicle_class: { name: string; name_zh: string | null } | null;
};

const copy = {
  zh: {
    card: { subject: (n: string) => `请绑定信用卡 · ${n}`, title: "请绑定信用卡", intro: "请点击下方按钮，绑定一张本人名下的信用卡。现在不会扣款，租金在取车时收取。", cta: "绑定信用卡" },
    pay: { subject: (n: string) => `请完成付款 · ${n}`, title: "请完成付款", intro: (amount: string) => `请点击下方按钮支付 ${amount}。`, cta: (amount: string) => `支付 ${amount}` },
    valid: (at: string) => `按钮有效至 ${at}。页面由 Stripe 提供，Movia 不保存完整卡号。`,
    rows: { vehicle: "车型", pickup: "取车", return: "还车", total: "合计" },
  },
  en: {
    card: { subject: (n: string) => `Add your card · ${n}`, title: "Add your card", intro: "Use the button below to add a credit card in your own name. Nothing is charged now; the rental is charged at pickup.", cta: "Add a card" },
    pay: { subject: (n: string) => `Complete your payment · ${n}`, title: "Complete your payment", intro: (amount: string) => `Use the button below to pay ${amount}.`, cta: (amount: string) => `Pay ${amount}` },
    valid: (at: string) => `The button works until ${at}. The page is hosted by Stripe; Movia does not keep your full card number.`,
    rows: { vehicle: "Vehicle", pickup: "Pickup", return: "Return", total: "Total" },
  },
};

export type PayLinkEmail = { sent: true; to: string } | { sent: false; reason: "no_email" | "email_failed" };

export async function payLinkRecipient(reservationId: string) {
  const { data } = await createAdminClient().from("reservations").select("customer:customers(email)").eq("id", reservationId).maybeSingle();
  return (data?.customer as unknown as { email: string | null } | null)?.email?.trim() || null;
}

export async function sendPayLinkEmail(reservationId: string, link: { paymentId: string; amountCents: number; expiresAt: Date }): Promise<PayLinkEmail> {
  const { data } = await createAdminClient()
    .from("reservations")
    .select("id, number, customer_id, pickup_at, return_at, total_cents, customer:customers(email, preferred_language), vehicle_class:vehicle_classes(name, name_zh)")
    .eq("id", reservationId)
    .maybeSingle();
  const row = data as unknown as Row | null;
  const to = row?.customer?.email?.trim();
  if (!row || !to) return { sent: false, reason: "no_email" };

  const locale = row.customer?.preferred_language === "zh" ? "zh" : "en";
  const text = copy[locale];
  const amount = formatMoney(link.amountCents);
  const paying = link.amountCents > 0;
  const vehicle = (locale === "zh" ? (row.vehicle_class?.name_zh ?? row.vehicle_class?.name) : row.vehicle_class?.name) ?? "";
  const rendered = renderEmail({
    preheader: `${row.number} · ${vehicle}`,
    title: paying ? text.pay.title : text.card.title,
    blocks: [
      { type: "paragraph", text: paying ? text.pay.intro(amount) : text.card.intro },
      {
        type: "rows",
        rows: [
          [text.rows.vehicle, vehicle],
          [text.rows.pickup, formatFullDateTime(row.pickup_at)],
          [text.rows.return, formatFullDateTime(row.return_at)],
          [text.rows.total, formatMoney(row.total_cents)],
        ],
      },
      { type: "button", label: paying ? text.pay.cta(amount) : text.card.cta, href: payUrl(link.paymentId) },
      { type: "paragraph", text: text.valid(formatFullDateTime(link.expiresAt.toISOString())) },
    ],
  });
  const result = await sendEmail({
    log: "customer",
    redact: [payToken(link.paymentId)],
    ref: { reservationId: row.id, customerId: row.customer_id },
    to,
    subject: (paying ? text.pay : text.card).subject(row.number),
    text: rendered.text,
    html: rendered.html,
  });
  return result.sent ? { sent: true, to } : { sent: false, reason: "email_failed" };
}
