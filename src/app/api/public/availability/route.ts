import { z } from "zod";
import { availabilityStatus, guardedJson, InvalidBody } from "@/features/booking/public-api";
import { countAvailable, listClasses, loadPrimaryLocation } from "@/features/booking/service";
import { isClockTime, isIsoDate, zonedToUtc } from "@/features/booking/time";

const input = z.object({
  classSlug: z.string().max(60).optional(),
  pickupDate: z.string().refine(isIsoDate),
  pickupTime: z.string().refine(isClockTime).default("10:00"),
  returnDate: z.string().refine(isIsoDate),
  returnTime: z.string().refine(isClockTime).default("10:00"),
});

export async function POST(request: Request) {
  return guardedJson(request, async (body) => {
    const parsed = input.safeParse(body);
    if (!parsed.success) throw new InvalidBody();
    const location = await loadPrimaryLocation();
    const pickupAt = zonedToUtc(parsed.data.pickupDate, parsed.data.pickupTime, location.timezone);
    const returnAt = zonedToUtc(parsed.data.returnDate, parsed.data.returnTime, location.timezone);
    if (returnAt <= pickupAt) throw new InvalidBody();

    const classes = (await listClasses()).filter((item) => !parsed.data.classSlug || item.slug === parsed.data.classSlug);
    const results = await Promise.all(
      classes.map(async (item) => {
        const available = (await countAvailable(item.id, pickupAt, returnAt)).length;
        return { slug: item.slug, available: available > 0, status: availabilityStatus(available) };
      }),
    );
    return { pickupAt: pickupAt.toISOString(), returnAt: returnAt.toISOString(), classes: results };
  });
}
