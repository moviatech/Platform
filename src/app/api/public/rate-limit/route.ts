import { z } from "zod";
import { guardedJson, InvalidBody } from "@/features/booking/public-api";
import { hitRateLimit } from "@/lib/rate-limit";

const input = z.object({
  key: z.string().regex(/^[\x21-\x7e]{1,120}$/),
  limit: z.number().int().min(1).max(1000),
  windowSeconds: z.number().int().min(10).max(86400),
});

export async function POST(request: Request) {
  return guardedJson(request, async (body) => {
    const parsed = input.safeParse(body);
    if (!parsed.success) throw new InvalidBody();
    return hitRateLimit(parsed.data.key, parsed.data.limit, parsed.data.windowSeconds);
  });
}
