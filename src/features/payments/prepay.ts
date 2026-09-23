import "server-only";
import { loadActiveConfig } from "@/features/booking/service";
import { applyBps, type Quote, type QuoteLine } from "@/features/pricing/quote";
import { lineRank, recomputeTotal } from "@/features/reservations/apply-change";
import { createAdminClient } from "@/lib/supabase/admin";

type Line = { type: string; code: string; description: string; quantity: number; unit_cents: number; amount_cents: number; taxable: boolean };

export async function prepayPreview(reservationId: string) {
  const supabase = createAdminClient();
  const [{ data: reservation }, { data: rows }, config] = await Promise.all([
    supabase.from("reservations").select("id, rate_plan, status, quote_snapshot").eq("id", reservationId).maybeSingle(),
    supabase.from("reservation_line_items").select("type, code, description, quantity, unit_cents, amount_cents, taxable").eq("reservation_id", reservationId),
    loadActiveConfig(),
  ]);
  if (!reservation || reservation.rate_plan !== "PAY_LATER") return null;
  const lines = (rows ?? []) as Line[];
  const manualCents = lines.filter((line) => line.code.startsWith("manual.")).reduce((sum, line) => sum + line.amount_cents, 0);
  const base = lines.filter((line) => !line.code.startsWith("manual.") && line.type !== "DISCOUNT" && line.type !== "TAX");
  const subtotal = base.reduce((sum, line) => sum + line.amount_cents, 0);
  const taxable = base.filter((line) => line.taxable).reduce((sum, line) => sum + line.amount_cents, 0);
  const existingTax = lines.find((line) => line.type === "TAX" && !line.code.startsWith("manual."))?.amount_cents ?? 0;
  const taxRateBps = taxable > 0 ? Math.round((existingTax * 10000) / taxable) : 0;
  const discount = applyBps(subtotal, config.data.payNowDiscountBps);
  const discountOnTaxable = subtotal > 0 ? Math.round((discount * taxable) / subtotal) : 0;
  const tax = applyBps(taxable - discountOnTaxable, taxRateBps);
  const quoteLines: QuoteLine[] = [
    ...base.map((line) => ({ type: line.type as QuoteLine["type"], code: line.code, description: line.description, quantity: Number(line.quantity), unitCents: line.unit_cents, amountCents: line.amount_cents, taxable: line.taxable })),
    ...(discount > 0 ? [{ type: "DISCOUNT" as const, code: "discount.pay_now", description: "Pay now discount", quantity: 1, unitCents: -discount, amountCents: -discount, taxable: true }] : []),
    ...(tax > 0 ? [{ type: "TAX" as const, code: "tax.sales", description: "Sales tax", quantity: 1, unitCents: tax, amountCents: tax, taxable: false }] : []),
  ];
  return {
    reservation,
    percent: config.data.payNowDiscountBps / 100,
    discountCents: discount,
    subtotalCents: subtotal,
    taxCents: tax,
    lines: quoteLines,
    totalCents: subtotal - discount + tax + manualCents,
    originalCents: subtotal + existingTax + manualCents,
  };
}

export async function applyPrepay(reservationId: string) {
  const preview = await prepayPreview(reservationId);
  if (!preview) return null;
  const supabase = createAdminClient();
  await supabase.from("reservation_line_items").delete().eq("reservation_id", reservationId).not("code", "like", "manual.%");
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
      discount_cents: preview.discountCents,
      tax_cents: preview.taxCents,
      quote_snapshot: { ...snapshot, lines: preview.lines, subtotalCents: preview.subtotalCents, discountCents: preview.discountCents, taxCents: preview.taxCents, totalCents: preview.totalCents },
    })
    .eq("id", reservationId);
  return recomputeTotal(reservationId);
}
