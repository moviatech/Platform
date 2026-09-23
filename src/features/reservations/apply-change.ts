import "server-only";
import { BookingError, driverCount, normalizeTrip, priceTrip, spouseIncluded, tripSchema, type PricedTrip } from "@/features/booking/service";
import { supersedeAgreements } from "@/features/portal/agreement-facts";
import { syncDriverSlots, syncInsuranceState } from "@/features/drivers/service";
import { zonedParts } from "@/features/booking/time";
import { notifyStaff } from "@/features/notifications/center";
import { notifyReservation } from "@/features/notifications/emails";
import { notifyOpsEmail } from "@/features/notifications/ops";
import { rentalKinds } from "@/features/payments/charge-line";
import { paidRentalCents } from "@/features/payments/service";
import type { Quote } from "@/features/pricing/quote";
import { audit } from "@/lib/audit";
import { rootDomain } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatMoney } from "@/lib/utils/format";
import { couponErrors, normalizeCode } from "@/features/coupons/rules";
import { adjustmentDescription, signedAdjustment, type AdjustmentKind } from "./adjustment";

export const editableStatuses = ["REQUESTED", "PENDING_PAYMENT", "CONFIRMED"];

export const lineRank: Record<string, number> = { RENTAL: 0, PROTECTION: 1, ADD_ON: 2, YOUNG_DRIVER: 3, DELIVERY: 4, ADDITIONAL: 5, FEE: 6, DISCOUNT: 8, TAX: 9 };

export type ChangeInput = {
  classSlug: string;
  pickupDate: string;
  pickupTime: string;
  returnDate: string;
  returnTime: string;
  protection: string;
  addOns: string[];
  ageBand: string;
  pickupMethod: string;
  deliveryAddress: string;
  extraDrivers: number;
  spouseDriver?: boolean;
  couponCode?: string;
};

export type ChangePreview = { priced: PricedTrip; quote: Quote; available: number };

type ReservationRow = {
  id: string;
  number: string;
  status: string;
  rate_plan: "PAY_NOW" | "PAY_LATER";
  class_id: string;
  pickup_at: string;
  return_at: string;
  total_cents: number;
  protection: string;
  add_ons: string[];
  extra_drivers: number;
  spouse_driver: boolean;
  driver_age_band: string;
  pickup_method: string;
  delivery_address: string | null;
  vehicle_class: { slug: string } | null;
  customer_id: string;
  coupon_id: string | null;
  coupon: { code: string } | null;
};

export async function loadEditableReservation(reservationId: string) {
  const { data } = await createAdminClient()
    .from("reservations")
    .select("id, number, status, rate_plan, class_id, pickup_at, return_at, total_cents, protection, add_ons, extra_drivers, spouse_driver, driver_age_band, pickup_method, delivery_address, customer_id, coupon_id, coupon:coupons(code), vehicle_class:vehicle_classes(slug)")
    .eq("id", reservationId)
    .maybeSingle();
  return data as unknown as ReservationRow | null;
}

export function currentChangeInput(reservation: ReservationRow, overrides: Partial<ChangeInput> = {}): ChangeInput {
  const zone = "America/Los_Angeles";
  const pickup = zonedParts(reservation.pickup_at, zone);
  const dropoff = zonedParts(reservation.return_at, zone);
  return {
    classSlug: reservation.vehicle_class?.slug ?? "",
    pickupDate: pickup.date,
    pickupTime: pickup.time,
    returnDate: dropoff.date,
    returnTime: dropoff.time,
    protection: reservation.protection,
    addOns: reservation.add_ons,
    ageBand: reservation.driver_age_band,
    pickupMethod: reservation.pickup_method,
    deliveryAddress: reservation.delivery_address ?? "",
    extraDrivers: reservation.extra_drivers ?? 0,
    spouseDriver: Boolean(reservation.spouse_driver),
    couponCode: reservation.coupon?.code ?? "",
    ...overrides,
  };
}

export async function addManualLine(input: { reservationId: string; kind: "fee" | "discount"; description: string; amountCents: number }) {
  const row = await manualLine(input);
  const { error } = await createAdminClient().from("reservation_line_items").insert(row);
  if (error) return null;
  return { cents: row.amount_cents, totalCents: await recomputeTotal(input.reservationId) };
}

async function manualLine(input: { reservationId: string; kind: AdjustmentKind; description: string; amountCents: number }) {
  const cents = signedAdjustment(input.kind, input.amountCents);
  let language: string | null = null;
  if (!input.description.trim()) {
    const { data } = await createAdminClient().from("reservations").select("customer:customers(preferred_language)").eq("id", input.reservationId).maybeSingle();
    language = (data as unknown as { customer: { preferred_language: string | null } | null } | null)?.customer?.preferred_language ?? null;
  }
  return {
    reservation_id: input.reservationId,
    type: input.kind === "fee" ? "ADDITIONAL" : "DISCOUNT",
    code: `manual.${input.kind}`,
    description: adjustmentDescription(input.kind, input.description, language),
    quantity: 1,
    unit_cents: cents,
    amount_cents: cents,
    taxable: false,
    sort_order: 200,
  };
}

export async function recomputeTotal(reservationId: string) {
  const supabase = createAdminClient();
  const { data: lines } = await supabase.from("reservation_line_items").select("type, code, amount_cents").eq("reservation_id", reservationId);
  const total = (lines ?? []).filter((line) => !(line.type === "ADDITIONAL" && !line.code.startsWith("manual."))).reduce((sum, line) => sum + line.amount_cents, 0);
  await supabase.from("reservations").update({ total_cents: total, price_reviewed_at: null, price_reviewed_by: null }).eq("id", reservationId);
  await supabase.rpc("sync_reservation_payment_state", { p_reservation_id: reservationId });
  return total;
}

export async function previewChange(reservation: ReservationRow, input: ChangeInput): Promise<ChangePreview> {
  const trip = tripSchema.safeParse({ ...input, ratePlan: reservation.rate_plan });
  if (!trip.success) throw new BookingError("invalid_trip");
  const { data: current } = await createAdminClient().from("reservations").select("pickup_location_id").eq("id", reservation.id).maybeSingle();
  const kept = Boolean(reservation.coupon) && normalizeCode(input.couponCode ?? reservation.coupon?.code) === reservation.coupon?.code;
  const priced = await priceTrip(
    { ...trip.data, couponCode: input.couponCode ?? reservation.coupon?.code ?? undefined, locationId: current?.pickup_location_id ?? undefined },
    { enforceLeadTime: false, coupon: { soft: kept, attachedId: reservation.coupon_id, reservationId: reservation.id } },
  );
  const { data: vehicles } = await createAdminClient().rpc("available_vehicles", {
    p_class_id: priced.vehicleClass.id,
    p_pickup_at: priced.pickupAt.toISOString(),
    p_return_at: priced.returnAt.toISOString(),
    p_ignore_reservation: reservation.id,
    p_location_id: current?.pickup_location_id ?? null,
  });
  return { priced, quote: priced.quote, available: (vehicles ?? []).length };
}

type Actor = { userId: string; displayName: string };

export async function applyChange(
  reservation: ReservationRow,
  input: ChangeInput,
  actor: Actor,
  options: { feeCents?: number; feeDescription?: string; source?: string; adjustment?: { kind: AdjustmentKind; description: string; amountCents: number } } = {},
): Promise<{ totalCents: number; quote: Quote }> {
  if (!editableStatuses.includes(reservation.status)) {
    const current = currentChangeInput(reservation);
    const inTrip =
      reservation.status === "ACTIVE" &&
      input.classSlug === current.classSlug &&
      input.pickupDate === current.pickupDate &&
      input.pickupTime === current.pickupTime &&
      `${input.returnDate} ${input.returnTime}` >= `${current.returnDate} ${current.returnTime}`;
    if (!inTrip) throw new BookingError("reservation_closed");
  }
  const trip = tripSchema.safeParse({ ...input, ratePlan: reservation.rate_plan });
  if (!trip.success) throw new BookingError("invalid_trip");
  const preview = await previewChange(reservation, input);
  if (preview.available === 0) throw new BookingError("no_vehicle_available");
  const { priced } = preview;
  const supabase = createAdminClient();
  if (options.adjustment) {
    const { data: manual } = await supabase.from("reservation_line_items").select("amount_cents").eq("reservation_id", reservation.id).like("code", "manual.%");
    const manualCents = (manual ?? []).reduce((sum, line) => sum + line.amount_cents, 0);
    if (priced.quote.totalCents + manualCents + signedAdjustment(options.adjustment.kind, options.adjustment.amountCents) < 0) throw new BookingError("invalid_adjustment");
  }
  const attached = Boolean(priced.coupon) && priced.coupon?.id !== reservation.coupon_id;
  if (priced.coupon && attached) {
    const { error: claimError } = await supabase.rpc("attach_coupon", { p_reservation_id: reservation.id, p_coupon_id: priced.coupon.id });
    if (claimError) throw new BookingError(couponErrors.find((item) => claimError.message.includes(item)) ?? "coupon_invalid");
  }

  const { error } = await supabase.rpc("reschedule_reservation", {
    p_reservation_id: reservation.id,
    p_class_id: priced.vehicleClass.id,
    p_pickup_at: priced.pickupAt.toISOString(),
    p_return_at: priced.returnAt.toISOString(),
  });
  if (error) {
    if (attached) await supabase.from("reservations").update({ coupon_id: reservation.coupon_id }).eq("id", reservation.id);
    const code = ["no_vehicle_available", "reservation_closed", "invalid_period", "class_not_found"].find((item) => error.message.includes(item));
    throw new BookingError(code ?? "failed");
  }

  await supabase.from("reservation_line_items").delete().eq("reservation_id", reservation.id).neq("type", "ADDITIONAL").not("code", "like", "manual.%");
  const inserts: Array<{ reservation_id: string; type: string; code: string; description: string; quantity: number; unit_cents: number; amount_cents: number; taxable: boolean; sort_order: number }> = priced.quote.lines.map((line, index) => ({
    reservation_id: reservation.id,
    type: line.type,
    code: line.code,
    description: line.description,
    quantity: line.quantity,
    unit_cents: line.unitCents,
    amount_cents: line.amountCents,
    taxable: line.taxable,
    sort_order: (lineRank[line.type] ?? 7) * 10 + index,
  }));
  if (options.feeCents && options.feeCents > 0) {
    inserts.push({
      reservation_id: reservation.id,
      type: "ADDITIONAL",
      code: "manual.fee",
      description: options.feeDescription ?? "Change fee",
      quantity: 1,
      unit_cents: options.feeCents,
      amount_cents: options.feeCents,
      taxable: false,
      sort_order: 200,
    });
  }
  if (options.adjustment) inserts.push(await manualLine({ reservationId: reservation.id, ...options.adjustment }));
  await supabase.from("reservation_line_items").insert(inserts);

  const deliveryAddress = trip.data.pickupMethod === "DELIVERY" ? input.deliveryAddress.trim().slice(0, 300) || null : null;
  await supabase
    .from("reservations")
    .update({
      rental_days: priced.quote.days,
      protection: trip.data.protection,
      add_ons: normalizeTrip(trip.data).addOns,
      extra_drivers: driverCount(trip.data),
      driver_age_band: trip.data.ageBand,
      pickup_method: trip.data.pickupMethod,
      delivery_address: deliveryAddress,
      agreement_state: "PENDING",
      return_reminder_at: null,
      overdue_notice_at: null,
      pricing_config_id: priced.configId,
      quote_snapshot: priced.quote,
      policy_snapshot: { cancelPolicy: priced.config.cancelPolicy, mileage: priced.config.mileage, returnGraceMinutes: priced.config.returnGraceMinutes },
      subtotal_cents: priced.quote.subtotalCents,
      discount_cents: priced.quote.discountCents,
      tax_cents: priced.quote.taxCents,
      tax_rate_bps: priced.quote.taxRateBps,
      taxable_cents: priced.quote.taxableCents,
      security_hold_cents: priced.quote.securityHoldCents,
      coupon_id: priced.coupon?.id ?? null,
    })
    .eq("id", reservation.id);
  const totalCents = await recomputeTotal(reservation.id);
  await syncDriverSlots(reservation.id, driverCount(trip.data), spouseIncluded(trip.data));
  await supersedeAgreements(reservation.id);
  await syncInsuranceState(reservation.id, trip.data.protection);

  await audit({
    actorUserId: actor.userId,
    actorType: "STAFF",
    action: "reservation.modified",
    entityType: "reservation",
    entityId: reservation.id,
    metadata: {
      by: actor.displayName,
      number: reservation.number,
      source: options.source ?? "staff",
      feeCents: options.feeCents ?? 0,
      before: { pickup_at: reservation.pickup_at, return_at: reservation.return_at, class_id: reservation.class_id, protection: reservation.protection, add_ons: reservation.add_ons, pickup_method: reservation.pickup_method, total_cents: reservation.total_cents },
      after: { pickup_at: priced.pickupAt.toISOString(), return_at: priced.returnAt.toISOString(), class_id: priced.vehicleClass.id, protection: trip.data.protection, add_ons: trip.data.addOns, pickup_method: trip.data.pickupMethod, total_cents: totalCents },
      coupon: priced.coupon?.code ?? (reservation.coupon ? `${reservation.coupon.code} removed` : undefined),
    },
  });
  await notifyReservation("updated", reservation.id).catch(() => undefined);
  const refundDue = (await paidRentalCents(reservation.id, rentalKinds).catch(() => 0)) - totalCents;
  if (refundDue > 0) {
    await notifyStaff({ kind: "refund.due", reservationId: reservation.id, href: `/reservations/${reservation.id}`, dedupeKey: `refund_due:${reservation.id}:${totalCents}`, params: { number: reservation.number, amount: formatMoney(refundDue) } });
    await notifyOpsEmail(`订单改动后应退 ${formatMoney(refundDue)} · ${reservation.number}`, [`${reservation.number} 改动后新总额 ${formatMoney(totalCents)}，客户已付超出 ${formatMoney(refundDue)}。`, "请在订单的付款面板发起退款。", `https://ops.${rootDomain}/reservations/${reservation.id}`]);
  }
  return { totalCents, quote: priced.quote };
}
