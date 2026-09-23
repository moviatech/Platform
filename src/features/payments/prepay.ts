import "server-only";
import { loadActiveConfig } from "@/features/booking/service";
import { isCouponLine, isQuotedLine, settleLines, type Quote, type QuoteLine } from "@/features/pricing/quote";
import { lineRank, recomputeTotal } from "@/features/reservations/apply-change";
import { createAdminClient } from "@/lib/supabase/admin";

type Line = { type: string; code: string; description: string; quantity: number; unit_cents: number; amount_cents: number; taxable: boolean };

export async function prepayPreview(reservationId: string) {
  const supabase = createAdminClient();
  const [{ data: reservation }, { data: rows }, config] = await Promise.all([
    supabase.from("reservations").select("id, rate_plan, status, quote_snapshot, tax_rate_bps").eq("id", reservationId).maybeSingle(),
    supabase.from("reservation_line_items").select("type, code, description, quantity, unit_cents, amount_cents, taxable").eq("reservation_id", reservationId),
    loadActiveConfig(),
  ]);
  if (!reservation || reservation.rate_plan !== "PAY_LATER") return null;
  const lines = (rows ?? []) as Line[];
  const manualCents = lines.filter((line) => line.code.startsWith("manual.")).reduce((sum, line) => sum + line.amount_cents, 0);
  const base = lines.filter(isQuotedLine);
  const existingTax = lines.find((line) => line.type === "TAX" && !line.code.startsWith("manual."))?.amount_cents ?? 0;
  const couponLines = lines.filter((line) => isCouponLine(line.code));
  const stackable = (reservation.quote_snapshot as Partial<Quote> | null)?.coupon?.stackable !== false;
  const taxRateBps = Number(reservation.tax_rate_bps ?? 0);
  const settled = settleLines(lines, { payNow: true, payNowBps: config.data.payNowDiscountBps, couponStackable: stackable, taxRateBps });
  const subtotal = settled.subtotalCents;
  const couponCents = settled.couponCents;
  const discount = settled.payNowCents;
  const tax = settled.taxCents;
  const asQuoteLine = (line: Line) => ({ type: line.type as QuoteLine["type"], code: line.code, description: line.description, quantity: Number(line.quantity), unitCents: line.unit_cents, amountCents: line.amount_cents, taxable: line.taxable });
  const quoteLines: QuoteLine[] = [
    ...base.map(asQuoteLine),
    ...couponLines.map(asQuoteLine),
    ...(discount > 0 ? [{ type: "DISCOUNT" as const, code: "discount.pay_now", description: "Pay now discount", quantity: 1, unitCents: -discount, amountCents: -discount, taxable: true }] : []),
    ...(tax > 0 ? [{ type: "TAX" as const, code: "tax.sales", description: "Sales tax", quantity: 1, unitCents: tax, amountCents: tax, taxable: false }] : []),
  ];
  return {
    reservation,
    percent: config.data.payNowDiscountBps / 100,
    discountCents: discount,
    subtotalCents: subtotal,
    taxCents: tax,
    taxableCents: settled.taxableCents,
    taxRateBps,
    lines: quoteLines,
    couponCents,
    totalCents: subtotal - couponCents - discount + tax + manualCents,
    originalCents: subtotal - couponCents + existingTax + manualCents,
  };
}

export async function applyPrepay(reservationId: string) {
  const preview = await prepayPreview(reservationId);
  if (!preview) return null;
  const supabase = createAdminClient();
  await supabase.from("reservation_line_items").delete().eq("reservation_id", reservationId).neq("type", "ADDITIONAL").not("code", "like", "manual.%");
  await supabase.from("reservation_line_items").insert(
    preview.lines.map((line, index) => ({
      reservation_id: reservationId,
      type: line.type,
      code: line.code,
      description: line.description,
      quantity: line.quantity,
      unit_cents: line.unitCents,
      amount_cents: line.amountCents,
      taxable: line.taxable,
      sort_order: (lineRank[line.type] ?? 7) * 10 + index,
    })),
  );
  const snapshot = (preview.reservation.quote_snapshot ?? {}) as Partial<Quote>;
  await supabase
    .from("reservations")
    .update({
      rate_plan: "PAY_NOW",
      subtotal_cents: preview.subtotalCents,
      discount_cents: preview.discountCents + preview.couponCents,
      tax_cents: preview.taxCents,
      taxable_cents: preview.taxableCents,
      quote_snapshot: { ...snapshot, lines: preview.lines, subtotalCents: preview.subtotalCents, discountCents: preview.discountCents + preview.couponCents, taxCents: preview.taxCents, taxableCents: preview.taxableCents, taxRateBps: preview.taxRateBps, totalCents: preview.totalCents },
    })
    .eq("id", reservationId);
  return recomputeTotal(reservationId);
}
