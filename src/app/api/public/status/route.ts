import { guardedJson } from "@/features/booking/public-api";
import { isAcceptingBookings } from "@/features/booking/status";

export async function GET(request: Request) {
  return guardedJson(request, async () => ({ acceptingBookings: await isAcceptingBookings() }));
}
