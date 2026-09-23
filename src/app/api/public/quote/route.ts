import { availabilityStatus, guardedJson, InvalidBody } from "@/features/booking/public-api";
import { countAvailable, priceTrip, tripSchema } from "@/features/booking/service";

export async function POST(request: Request) {
  return guardedJson(request, async (body) => {
    const parsed = tripSchema.safeParse(body);
    if (!parsed.success) throw new InvalidBody();
    const priced = await priceTrip(parsed.data, { enforceLeadTime: false });
    const available = (await countAvailable(priced.vehicleClass.id, priced.pickupAt, priced.returnAt)).length;
    return {
      classSlug: priced.vehicleClass.slug,
      pickupAt: priced.pickupAt.toISOString(),
      returnAt: priced.returnAt.toISOString(),
      available: available > 0,
      status: availabilityStatus(available),
      quote: priced.quote,
    };
  });
}
