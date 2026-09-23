import "server-only";
import { NextResponse } from "next/server";
import { hasValidApiKey } from "@/lib/api-auth";
import { BookingError } from "./service";

const statusByCode: Record<string, number> = {
  class_not_found: 404,
  no_vehicle_available: 409,
  customer_blocked: 409,
  invalid_period: 422,
  too_long: 422,
  too_soon: 422,
  outside_hours: 422,
  invalid_protection: 422,
  invalid_add_on: 422,
  invalid_days: 422,
  bookings_paused: 503,
};

export async function guardedJson<T>(request: Request, handler: (body: unknown) => Promise<T>) {
  if (!hasValidApiKey(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  let body: unknown = null;
  if (request.method !== "GET") {
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "invalid_json" }, { status: 400 });
    }
  }
  try {
    return NextResponse.json(await handler(body), { headers: { "Cache-Control": "no-store" } });
  } catch (cause) {
    if (cause instanceof BookingError) {
      return NextResponse.json({ error: cause.code }, { status: statusByCode[cause.code] ?? 500 });
    }
    if (cause instanceof InvalidBody) {
      return NextResponse.json({ error: "invalid_fields" }, { status: 422 });
    }
    console.error("[public-api]", cause instanceof Error ? cause.message : cause);
    return NextResponse.json({ error: "unavailable" }, { status: 500 });
  }
}

export class InvalidBody extends Error {}

export function availabilityStatus(available: number) {
  if (available <= 0) return "unavailable" as const;
  if (available === 1) return "limited" as const;
  return "available" as const;
}
