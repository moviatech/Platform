import { NextResponse } from "next/server";
import Stripe from "stripe";
import { processStripeEvent } from "@/features/payments/webhook";

export const maxDuration = 60;

export async function POST(request: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  const signature = request.headers.get("stripe-signature");
  if (!secret || !signature) {
    return NextResponse.json({ error: "not_configured" }, { status: 400 });
  }

  const payload = await request.text();
  let event: Stripe.Event;
  try {
    event = await Stripe.webhooks.constructEventAsync(payload, signature, secret);
  } catch {
    return NextResponse.json({ error: "invalid_signature" }, { status: 400 });
  }

  try {
    const outcome = await processStripeEvent(event);
    return NextResponse.json({ received: true, outcome });
  } catch (cause) {
    console.error("[webhooks:stripe]", event.type, cause instanceof Error ? cause.message : cause);
    return NextResponse.json({ error: "processing_failed" }, { status: 500 });
  }
}
