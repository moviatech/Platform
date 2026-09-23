import { z } from "zod";
import { guardedJson, InvalidBody } from "@/features/booking/public-api";
import { priceTrip, tripSchema } from "@/features/booking/service";
import { isAcceptingBookings } from "@/features/booking/status";
import { BookingError } from "@/features/booking/service";
import { createDraftIntent } from "@/features/payments/service";
import { stripeConfigured } from "@/lib/stripe";

const input = z.object({ trip: tripSchema, paymentIntentId: z.string().regex(/^pi_[A-Za-z0-9]+$/).optional() });

export async function POST(request: Request) {
  return guardedJson(request, async (body) => {
    const parsed = input.safeParse(body);
    if (!parsed.success) throw new InvalidBody();
    const publishableKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
    if (!stripeConfigured() || !publishableKey) return { payment: null };
    if (!(await isAcceptingBookings())) throw new BookingError("bookings_paused");
    const priced = await priceTrip(parsed.data.trip, { enforceLeadTime: true });
    const intent = await createDraftIntent(priced.quote.totalCents, parsed.data.paymentIntentId);
    return { payment: { paymentIntentId: intent.id, clientSecret: intent.clientSecret, publishableKey, amountCents: intent.amountCents } };
  });
}
