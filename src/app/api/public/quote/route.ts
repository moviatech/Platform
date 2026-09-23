import { availabilityStatus, guardedJson, InvalidBody } from "@/features/booking/public-api";
import { countAvailable, priceTrip, tripSchema } from "@/features/booking/service";

export async function POST(request: Request) {
  return guardedJson(request, async (body) => {
    const parsed = tripSchema.safeParse(body);
    if (!parsed.success) throw new InvalidBody();
    const priced = await priceTrip(parsed.data, { enforceLeadTime: false, coupon: { soft: true }, web: true });
    const available = (await countAvailable(priced.vehicleClass.id, priced.pickupAt, priced.returnAt, priced.location.id)).length;
    return {
      classSlug: priced.vehicleClass.slug,
      pickupAt: priced.pickupAt.toISOString(),
      returnAt: priced.returnAt.toISOString(),
      available: available > 0,
      status: availabilityStatus(available),
      quote: priced.quote,
      coupon: parsed.data.couponCode ? { code: priced.coupon?.code ?? parsed.data.couponCode.toUpperCase(), applied: Boolean(priced.coupon), discountCents: priced.quote.coupon?.discountCents ?? 0, error: priced.couponError ?? null } : null,
    };
  });
}
