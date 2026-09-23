"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { pricingConfigSchema } from "@/features/pricing/config";
import { audit } from "@/lib/audit";
import { requirePermission } from "@/lib/auth/staff";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ReservationActionState } from "./actions";

const rank: Record<string, number> = { RENTAL: 0, PROTECTION: 1, ADD_ON: 2, YOUNG_DRIVER: 3, DELIVERY: 4, ADDITIONAL: 5, FEE: 6, DISCOUNT: 8, TAX: 9 };

const input = z.object({
  reservationId: z.uuid(),
  amount: z
    .string()
    .trim()
    .regex(/^\d{1,5}(\.\d{1,2})?$/)
    .transform((value) => Math.round(Number(value) * 100)),
});

export async function setDeliveryFee(_: ReservationActionState, form: FormData): Promise<ReservationActionState> {
  const session = await requirePermission("reservation.edit");
  const parsed = input.safeParse({ reservationId: form.get("reservationId"), amount: form.get("amount") });
  if (!parsed.success) return { error: "invalid" };
  const { reservationId, amount } = parsed.data;

  const supabase = createAdminClient();
  const { data: reservation } = await supabase
    .from("reservations")
    .select("status, rate_plan, pricing_config_id, pickup_location_id, number, total_cents")
    .eq("id", reservationId)
    .maybeSingle();
  if (!reservation) return { error: "not_found" };
  if (!["REQUESTED", "PENDING_PAYMENT", "CONFIRMED"].includes(reservation.status)) return { error: "reservation_closed" };

  const [{ data: config }, { data: location }, { data: lines }] = await Promise.all([
    supabase.from("pricing_configs").select("data").eq("id", reservation.pricing_config_id).single(),
    supabase.from("locations").select("tax_rate_bps").eq("id", reservation.pickup_location_id).single(),
    supabase.from("reservation_line_items").select("id, type, code, amount_cents, sort_order").eq("reservation_id", reservationId).order("sort_order"),
  ]);
  if (!config || !location) return { error: "failed" };
  const rules = pricingConfigSchema.parse(config.data);

  const manual = (lines ?? []).filter((line) => line.code.startsWith("manual."));
  const kept = (lines ?? []).filter((line) => !["DELIVERY", "DISCOUNT", "TAX"].includes(line.type) && !line.code.startsWith("manual."));
  const subtotal = kept.reduce((sum, line) => sum + line.amount_cents, 0) + amount;
  const discount = reservation.rate_plan === "PAY_NOW" ? Math.round((subtotal * rules.payNowDiscountBps) / 10000) : 0;
  const tax = Math.round(((subtotal - discount) * location.tax_rate_bps) / 10000);
  const total = subtotal - discount + tax + manual.reduce((sum, line) => sum + line.amount_cents, 0);

  const removable = (lines ?? []).filter((line) => ["DELIVERY", "DISCOUNT", "TAX"].includes(line.type)).map((line) => line.id);
  if (removable.length) await supabase.from("reservation_line_items").delete().in("id", removable);

  const inserts = [
    ...(amount > 0 ? [{ type: "DELIVERY", code: "fee.delivery", description: "Delivery", quantity: 1, unit_cents: amount, amount_cents: amount, taxable: true }] : []),
    ...(discount > 0 ? [{ type: "DISCOUNT", code: "discount.pay_now", description: "Pay now discount", quantity: 1, unit_cents: -discount, amount_cents: -discount, taxable: true }] : []),
    ...(tax > 0 ? [{ type: "TAX", code: "tax.sales", description: "Sales tax", quantity: 1, unit_cents: tax, amount_cents: tax, taxable: false }] : []),
  ].map((line) => ({ ...line, reservation_id: reservationId, sort_order: rank[line.type] * 10 }));
  if (inserts.length) {
    const { error } = await supabase.from("reservation_line_items").insert(inserts);
    if (error) return { error: "failed" };
  }
  for (const line of kept) {
    const order = (rank[line.type] ?? 7) * 10 + (line.sort_order % 10);
    if (order !== line.sort_order) await supabase.from("reservation_line_items").update({ sort_order: order }).eq("id", line.id);
  }

  const { error } = await supabase
    .from("reservations")
    .update({ subtotal_cents: subtotal, discount_cents: discount, tax_cents: tax, total_cents: total })
    .eq("id", reservationId);
  if (error) return { error: "failed" };
  await supabase.rpc("sync_reservation_payment_state", { p_reservation_id: reservationId });

  await audit({
    actorUserId: session.userId,
    actorType: "STAFF",
    action: "reservation.delivery_fee_set",
    entityType: "reservation",
    entityId: reservationId,
    metadata: { by: session.displayName, number: reservation.number, deliveryCents: amount, totalBefore: reservation.total_cents, totalAfter: total },
  });
  revalidatePath(`/ops/reservations/${reservationId}`);
  return { ok: true };
}
