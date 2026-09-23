import { NextResponse } from "next/server";
import { runMileageTick } from "@/features/investor/mileage";
import { settleDueShares } from "@/features/investor/share";
import { purgeExpiredMedia } from "@/features/media/retention";
import { renewExpiringHolds } from "@/features/payments/renewal";
import { closePaymentsOnClosedOrders } from "@/features/payments/service";
import { syncStripe } from "@/features/finance/stripe-sync";
import { expireStaleReservations } from "@/features/reservations/expire";
import { sendReturnReminders } from "@/features/reservations/reminders";
import { runSelfServiceTick } from "@/features/selfservice/service";
import { hasValidInternalKey } from "@/lib/api-auth";
import { stripeConfigured } from "@/lib/stripe";

async function step<T>(name: string, run: () => Promise<T>): Promise<T | { error: string }> {
  try {
    return await run();
  } catch (cause) {
    const error = cause instanceof Error ? cause.message : "failed";
    console.error("[tick:failed]", name, error);
    return { error };
  }
}

export async function POST(request: Request) {
  if (!hasValidInternalKey(request)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  await step("expire", () => expireStaleReservations());
  const closedPayments = await step("closedPayments", () => closePaymentsOnClosedOrders());
  const holds = stripeConfigured() ? await step("holds", () => renewExpiringHolds()) : { checked: 0, renewed: 0, failed: 0, skipped: 0 };
  const media = await step("media", () => purgeExpiredMedia());
  const selfService = await step("selfService", () => runSelfServiceTick());
  const reminders = await step("reminders", () => sendReturnReminders());
  const investorShares = await step("investorShares", () => settleDueShares());
  const mileage = await step("mileage", () => runMileageTick());
  const stripeLedger = stripeConfigured() ? await step("stripeLedger", () => syncStripe()) : null;
  return NextResponse.json({ ok: true, holds, media, selfService, reminders, investorShares, mileage, stripeLedger, closedPayments }, { headers: { "Cache-Control": "no-store" } });
}
