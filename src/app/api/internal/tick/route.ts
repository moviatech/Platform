import { NextResponse } from "next/server";
import { settleDueShares } from "@/features/investor/share";
import { purgeExpiredMedia } from "@/features/media/retention";
import { renewExpiringHolds } from "@/features/payments/renewal";
import { expireStaleReservations } from "@/features/reservations/expire";
import { runSelfServiceTick } from "@/features/selfservice/service";
import { hasValidInternalKey } from "@/lib/api-auth";
import { stripeConfigured } from "@/lib/stripe";

export async function POST(request: Request) {
  if (!hasValidInternalKey(request)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  await expireStaleReservations();
  const holds = stripeConfigured() ? await renewExpiringHolds() : { checked: 0, renewed: 0, failed: 0, skipped: 0 };
  const media = await purgeExpiredMedia();
  const selfService = await runSelfServiceTick();
  const investorShares = await settleDueShares().catch((cause) => ({ error: cause instanceof Error ? cause.message : "failed" }));
  return NextResponse.json({ ok: true, holds, media, selfService, investorShares }, { headers: { "Cache-Control": "no-store" } });
}
