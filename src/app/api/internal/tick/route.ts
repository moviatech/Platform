import { NextResponse } from "next/server";
import { renewExpiringHolds } from "@/features/payments/renewal";
import { expireStaleReservations } from "@/features/reservations/expire";
import { hasValidInternalKey } from "@/lib/api-auth";
import { stripeConfigured } from "@/lib/stripe";

export async function POST(request: Request) {
  if (!hasValidInternalKey(request)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  await expireStaleReservations();
  const holds = stripeConfigured() ? await renewExpiringHolds() : { checked: 0, renewed: 0, failed: 0, skipped: 0 };
  return NextResponse.json({ ok: true, holds }, { headers: { "Cache-Control": "no-store" } });
}
