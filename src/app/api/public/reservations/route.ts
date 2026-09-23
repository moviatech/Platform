import { z } from "zod";
import { guardedJson, InvalidBody } from "@/features/booking/public-api";
import { BookingError, createReservation, priceTrip, tripSchema } from "@/features/booking/service";
import { isAcceptingBookings } from "@/features/booking/status";
import { notifyStaff } from "@/features/notifications/center";
import { notifyReservation } from "@/features/notifications/emails";
import { notifyOpsEmail } from "@/features/notifications/ops";
import { attachDraftIntent, attachDraftSetup, createRentalPaymentIntent, draftSetupUsable } from "@/features/payments/service";
import { minimumChargeCents } from "@/features/pricing/quote";
import { rootDomain } from "@/lib/env";
import { stripeConfigured } from "@/lib/stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatMoney } from "@/lib/utils/format";

const input = z.object({
  trip: tripSchema,
  customer: z.object({
    fullName: z.string().trim().min(1).max(120),
    email: z.email().max(200),
    phone: z.string().trim().min(7).max(40),
    wechat: z.string().trim().max(60).optional(),
    language: z.enum(["zh", "en"]).default("en"),
  }),
  deliveryAddress: z.string().trim().max(300).optional(),
  notes: z.string().trim().max(2000).optional(),
  reference: z.string().trim().max(80).optional(),
  paymentIntentId: z.string().regex(/^pi_[A-Za-z0-9]+$/).optional(),
  setupIntentId: z.string().regex(/^seti_[A-Za-z0-9]+$/).optional(),
});

export async function POST(request: Request) {
  return guardedJson(request, async (body) => {
    const parsed = input.safeParse(body);
    if (!parsed.success) throw new InvalidBody();
    const { trip, customer, deliveryAddress, notes, reference, paymentIntentId, setupIntentId } = parsed.data;
    if (!(await isAcceptingBookings())) throw new BookingError("bookings_paused");

    const publishableKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
    const priced = await priceTrip(trip, { enforceLeadTime: true, web: true });
    const payNow = trip.ratePlan === "PAY_NOW" && stripeConfigured() && Boolean(publishableKey) && priced.quote.totalCents >= minimumChargeCents;
    const cardFirst = trip.ratePlan === "PAY_LATER" && stripeConfigured() && Boolean(publishableKey);
    if (cardFirst && !(setupIntentId && (await draftSetupUsable(setupIntentId)))) throw new BookingError("card_required");
    const quoteFirst = trip.pickupMethod === "DELIVERY" || Boolean(deliveryAddress);
    const held = payNow || cardFirst;
    const created = await createReservation({
      priced,
      trip,
      customer: { fullName: customer.fullName, email: customer.email, phone: customer.phone, wechat: customer.wechat ?? null, language: customer.language },
      status: payNow || (cardFirst && !quoteFirst) ? "PENDING_PAYMENT" : "REQUESTED",
      source: "WEB",
      expiresAt: new Date(Date.now() + (held ? 45 * 60000 : priced.config.requestHoldHours * 3600000)),
      deliveryAddress: deliveryAddress ?? null,
      customerNotes: notes ?? null,
      internalNotes: reference ? `Website reference ${reference}` : null,
    });

    const supabase = createAdminClient();
    if (trip.pickupMethod === "SELF_SERVICE") await supabase.from("reservations").update({ self_service_state: "REQUESTED" }).eq("id", created.id);
    await supabase.from("audit_events").insert({
      actor_type: "API",
      action: "reservation.requested",
      entity_type: "reservation",
      entity_id: created.id,
      metadata: { number: created.number, source: "WEB", totalCents: priced.quote.totalCents, payNow, cardFirst },
    });

    let payment: { paymentIntentId: string; clientSecret: string; publishableKey: string; amountCents: number } | null = null;
    let setup: { setupIntentId: string; clientSecret: string; publishableKey: string } | null = null;
    if (payNow) {
      try {
        const intent = paymentIntentId ? await attachDraftIntent(created.id, paymentIntentId) : await createRentalPaymentIntent(created.id);
        payment = { paymentIntentId: intent.clientSecret.split("_secret_")[0], clientSecret: intent.clientSecret, publishableKey: publishableKey as string, amountCents: intent.amountCents };
      } catch (cause) {
        console.error("[reservations:intent]", cause instanceof Error ? cause.message : cause);
      }
    } else if (cardFirst) {
      try {
        const intent = await attachDraftSetup(created.id, setupIntentId as string);
        setup = { setupIntentId: intent.id, clientSecret: intent.clientSecret, publishableKey: publishableKey as string };
      } catch (cause) {
        console.error("[reservations:setup]", cause instanceof Error ? cause.message : cause);
        await supabase.rpc("set_reservation_status", { p_reservation_id: created.id, p_status: "EXPIRED", p_reason: "card_setup_failed" });
        throw new BookingError("card_setup_failed");
      }
    } else {
      await notifyReservation("requested", created.id).catch(() => undefined);
      await notifyStaff({
        kind: "reservation.requested",
        reservationId: created.id,
        href: `/reservations/${created.id}`,
        params: { number: created.number, name: customer.fullName, vehicle: priced.vehicleClass.name, from: trip.pickupDate, to: trip.returnDate, total: formatMoney(priced.quote.totalCents) },
      });
      await notifyOpsEmail(`新订车请求 / New booking request · ${created.number}`, [
        `${created.number} · ${priced.vehicleClass.name} · ${priced.location.name}`,
        `${trip.pickupDate} ${trip.pickupTime} → ${trip.returnDate} ${trip.returnTime} (${priced.quote.days}d)`,
        `Total ${formatMoney(priced.quote.totalCents)} · ${trip.ratePlan}`,
        "",
        `${customer.fullName} · ${customer.phone} · ${customer.email}${customer.wechat ? ` · WeChat ${customer.wechat}` : ""}`,
        notes ? `\n${notes}` : "",
        "",
        `https://ops.${rootDomain}/reservations/${created.id}`,
      ]);
    }

    return { id: created.id, number: created.number, totalCents: priced.quote.totalCents, quote: priced.quote, payment, setup };
  });
}
