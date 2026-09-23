import { z } from "zod";
import { guardedJson, InvalidBody } from "@/features/booking/public-api";
import { BookingError, createReservation, priceTrip, tripSchema } from "@/features/booking/service";
import { isAcceptingBookings } from "@/features/booking/status";
import { notifyReservation } from "@/features/notifications/emails";
import { sendEmail } from "@/lib/email";
import { rootDomain } from "@/lib/env";
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
});

export async function POST(request: Request) {
  return guardedJson(request, async (body) => {
    const parsed = input.safeParse(body);
    if (!parsed.success) throw new InvalidBody();
    const { trip, customer, deliveryAddress, notes, reference } = parsed.data;
    if (!(await isAcceptingBookings())) throw new BookingError("bookings_paused");

    const priced = await priceTrip(trip, { enforceLeadTime: true });
    const created = await createReservation({
      priced,
      trip,
      customer: { fullName: customer.fullName, email: customer.email, phone: customer.phone, wechat: customer.wechat ?? null, language: customer.language },
      status: "REQUESTED",
      source: "WEB",
      expiresAt: new Date(Date.now() + priced.config.requestHoldHours * 3600000),
      deliveryAddress: deliveryAddress ?? null,
      customerNotes: notes ?? null,
      internalNotes: reference ? `Website reference ${reference}` : null,
    });

    await createAdminClient().from("audit_events").insert({
      actor_type: "API",
      action: "reservation.requested",
      entity_type: "reservation",
      entity_id: created.id,
      metadata: { number: created.number, source: "WEB", totalCents: priced.quote.totalCents },
    });

    await notifyReservation("requested", created.id).catch(() => undefined);

    const notify = process.env.NOTIFY_EMAIL;
    if (notify) {
      await sendEmail({
        to: notify.split(",").map((item) => item.trim()).filter(Boolean),
        subject: `[Movia] 新订车请求 / New booking request · ${created.number}`,
        text: [
          `${created.number} · ${priced.vehicleClass.name}`,
          `${trip.pickupDate} ${trip.pickupTime} → ${trip.returnDate} ${trip.returnTime} (${priced.quote.days}d)`,
          `Total ${formatMoney(priced.quote.totalCents)} · ${trip.ratePlan}`,
          "",
          `${customer.fullName} · ${customer.phone} · ${customer.email}${customer.wechat ? ` · WeChat ${customer.wechat}` : ""}`,
          notes ? `\n${notes}` : "",
          "",
          `https://ops.${rootDomain}/reservations/${created.id}`,
        ].join("\n"),
        replyTo: customer.email,
      }).catch(() => undefined);
    }

    return { id: created.id, number: created.number, totalCents: priced.quote.totalCents, quote: priced.quote };
  });
}
