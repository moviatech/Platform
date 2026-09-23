import "server-only";
import { sendEmail } from "@/lib/email";
import { renderEmail, type EmailBlock } from "@/lib/email/template";
import { portalOrigin } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatFullDateTime, formatMoney } from "@/lib/utils/format";
import { notifyCustomer } from "./center";

export type ReceiptReason = "rental" | "additional" | "damage" | "hold" | "cancellation";

const reasonLabels: Record<"zh" | "en", Record<ReceiptReason, string>> = {
  zh: { rental: "租金", additional: "附加费用", damage: "车损赔付", hold: "押金扣款", cancellation: "取消费" },
  en: { rental: "Rental", additional: "Additional charge", damage: "Damage charge", hold: "Security hold capture", cancellation: "Cancellation fee" },
};

const methodLabels: Record<"zh" | "en", Record<string, string>> = {
  zh: { TRANSFER: "银行转账", ZELLE: "Zelle", CASH: "现金", OTHER: "线下付款" },
  en: { TRANSFER: "Bank transfer", ZELLE: "Zelle", CASH: "Cash", OTHER: "Offline payment" },
};

const kindReason: Record<string, ReceiptReason> = { RENTAL: "rental", ADDITIONAL: "additional", CANCELLATION_FEE: "cancellation", SECURITY_HOLD: "hold" };

const feeLabels: Record<"zh" | "en", Record<string, string>> = {
  zh: { excess_mileage: "超里程", low_charge: "电量不足", late_return: "逾期（按天）", late_hours: "逾期（按小时）", cleaning: "清洁费", supercharging: "超充费用", other: "其他" },
  en: { excess_mileage: "Excess mileage", low_charge: "Low charge", late_return: "Late return", late_hours: "Late return (hourly)", cleaning: "Cleaning", supercharging: "Supercharging", other: "Other" },
};

type Customer = { email: string | null; preferred_language: string; stripe_card_brand: string | null; stripe_card_last4: string | null };

type PaymentRow = {
  id: string;
  reservation_id: string;
  customer_id: string | null;
  kind: string;
  amount_cents: number;
  amount_captured_cents: number | null;
  offline_method: string | null;
  created_at: string;
  reservation: { number: string } | null;
  customer: Customer | null;
};

const cardLabel = (customer: Customer | null, zh: boolean) => (customer?.stripe_card_last4 ? `${customer.stripe_card_brand ? `${customer.stripe_card_brand.toUpperCase()} ` : ""}${zh ? "尾号 " : "ending "}${customer.stripe_card_last4}` : zh ? "已保存的卡" : "Card on file");

export async function notifyPaymentReceipt(paymentId: string, options: { reason?: ReceiptReason; note?: string | null; amountCents?: number } = {}) {
  const { data } = await createAdminClient()
    .from("payments")
    .select("id, reservation_id, customer_id, kind, amount_cents, amount_captured_cents, offline_method, created_at, reservation:reservations(number), customer:customers(email, preferred_language, stripe_card_brand, stripe_card_last4)")
    .eq("id", paymentId)
    .maybeSingle();
  const row = data as unknown as PaymentRow | null;
  if (!row?.reservation || !row.customer_id) return { sent: false as const };
  const amount = options.amountCents ?? (row.amount_captured_cents || row.amount_cents);
  if (amount <= 0) return { sent: false as const };
  const number = row.reservation.number;
  const inserted = await notifyCustomer(row.customer_id, { kind: "payment.receipt", reservationId: row.reservation_id, href: `/trips/${number}`, dedupeKey: `receipt:${paymentId}:${amount}`, params: { number, amount: formatMoney(amount) } });
  if (!inserted || !row.customer?.email) return { sent: false as const };
  const zh = row.customer.preferred_language === "zh";
  const locale = zh ? "zh" : "en";
  const reason = options.reason ?? kindReason[row.kind] ?? "additional";
  const paid = reason === "rental";
  const method = row.offline_method ? (methodLabels[locale][row.offline_method] ?? methodLabels[locale].OTHER) : cardLabel(row.customer, zh);
  const title = paid ? (zh ? "已收到付款" : "Payment received") : zh ? "扣款通知" : "Charge notice";
  const intro = paid
    ? zh
      ? "感谢你的付款，以下是本次付款的记录。"
      : "Thank you. Here is the record of this payment."
    : zh
      ? "我们已按租赁协议从你的付款方式收取以下费用。如有疑问，请直接回复本邮件。"
      : "Under your rental agreement we have charged the following to your payment method. Reply to this email with any questions.";
  const rows: Array<[string, string]> = [
    [zh ? "订单" : "Reservation", number],
    [zh ? "项目" : "Item", `${reasonLabels[locale][reason]}${options.note ? ` · ${options.note}` : ""}`],
    [zh ? "金额" : "Amount", formatMoney(amount)],
    [zh ? "支付方式" : "Paid with", method],
    [zh ? "时间" : "Time", formatFullDateTime(row.created_at)],
  ];
  const rendered = renderEmail({
    preheader: `${number} · ${formatMoney(amount)}`,
    title,
    blocks: [
      { type: "paragraph", text: intro },
      { type: "rows", rows },
      { type: "button", label: zh ? "查看行程" : "View trip", href: `${portalOrigin}/trips/${number}` },
    ],
  });
  return sendEmail({ to: row.customer.email, subject: `${title} · ${number} · ${formatMoney(amount)}`, text: rendered.text, html: rendered.html });
}

export type SettlementInput = {
  fees: Array<{ code: string; amountCents: number; label?: string }>;
  taxCents: number;
  chargedCents: number;
  capturedCents: number;
  uncollectedCents: number;
  released: boolean;
  damageCents: number;
  tollPending: boolean;
};

export async function notifyReturnSettlement(reservationId: string, input: SettlementInput) {
  const { data } = await createAdminClient().from("reservations").select("id, number, customer_id, customer:customers(email, preferred_language, stripe_card_brand, stripe_card_last4)").eq("id", reservationId).maybeSingle();
  const row = data as unknown as { id: string; number: string; customer_id: string | null; customer: Customer | null } | null;
  if (!row?.customer_id) return { sent: false as const };
  const total = input.fees.reduce((sum, fee) => sum + fee.amountCents, 0) + input.taxCents;
  const inserted = await notifyCustomer(row.customer_id, { kind: "reservation.settled", reservationId, href: `/trips/${row.number}`, dedupeKey: `settled:${reservationId}`, params: { number: row.number, amount: formatMoney(total) } });
  if (!inserted || !row.customer?.email) return { sent: false as const };
  const zh = row.customer.preferred_language === "zh";
  const locale = zh ? "zh" : "en";
  const blocks: EmailBlock[] = [{ type: "paragraph", text: zh ? "车辆已归还，感谢你选择 Movia。以下是这次还车的结算明细。" : "Your vehicle has been returned. Thank you for choosing Movia. Here is the summary of this return." }];
  if (total > 0) {
    blocks.push({
      type: "rows",
      rows: [
        ...input.fees.map((fee) => [fee.label ?? feeLabels[locale][fee.code] ?? fee.code, formatMoney(fee.amountCents)] as [string, string]),
        ...(input.taxCents > 0 ? [[zh ? "销售税" : "Sales tax", formatMoney(input.taxCents)] as [string, string]] : []),
        [zh ? "还车后费用合计" : "Post-rental total", formatMoney(total)],
      ],
    });
  } else {
    blocks.push({ type: "paragraph", text: zh ? "本次还车没有产生额外费用。" : "No additional charges were made for this return." });
  }
  const notes: string[] = [];
  if (input.chargedCents > 0) notes.push(zh ? `已从${cardLabel(row.customer, true)}收取 ${formatMoney(input.chargedCents)}。` : `${formatMoney(input.chargedCents)} was charged to your ${cardLabel(row.customer, false)}.`);
  if (input.capturedCents > 0) notes.push(zh ? `已从押金预授权中扣取 ${formatMoney(input.capturedCents)}。` : `${formatMoney(input.capturedCents)} was captured from your security hold.`);
  if (input.uncollectedCents > 0) notes.push(zh ? `尚有 ${formatMoney(input.uncollectedCents)} 未收取，我们会与你联系。` : `${formatMoney(input.uncollectedCents)} is still outstanding. We will contact you about it.`);
  if (input.released) notes.push(zh ? "押金预授权已释放，额度通常在 3–7 个工作日内恢复，以发卡行为准。" : "Your security hold has been released. The funds usually return within 3–7 business days, depending on your bank.");
  if (input.damageCents > 0) notes.push(zh ? `还车时记录到车辆损伤，预估 ${formatMoney(input.damageCents)}。这笔费用需要你在行程页确认后才会收取，详情见另一封邮件。` : `Damage was recorded at return, estimated at ${formatMoney(input.damageCents)}. It is only charged after you confirm it on the trip page; see the separate email.`);
  if (input.tollPending) notes.push(zh ? "过路费账单到达后会另行通知并收取。" : "Tolls will be billed separately once the toll statement arrives.");
  for (const text of notes) blocks.push({ type: "paragraph", text });
  blocks.push({ type: "button", label: zh ? "查看行程" : "View trip", href: `${portalOrigin}/trips/${row.number}` });
  const title = zh ? "还车结算" : "Return summary";
  const rendered = renderEmail({ preheader: `${row.number} · ${formatMoney(total)}`, title, blocks });
  return sendEmail({ to: row.customer.email, subject: `${title} · ${row.number}`, text: rendered.text, html: rendered.html });
}
