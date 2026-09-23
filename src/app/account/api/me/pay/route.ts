import { NextResponse } from "next/server";
import { z } from "zod";
import { chargeSavedCard, confirmReservationAfterPayment, paidRentalCents, PaymentError } from "@/features/payments/service";
import { audit } from "@/lib/audit";
import { getCustomerSession } from "@/lib/auth/customer";
import { websiteOrigin } from "@/lib/env";
import { stripeConfigured } from "@/lib/stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { meHeaders } from "../route";

const input = z.object({ number: z.string().regex(/^MV-[A-Z0-9]{6}$/) });

export async function POST(request: Request) {
  if (request.headers.get("origin") !== websiteOrigin) return NextResponse.json({ error: "forbidden" }, { status: 403, headers: meHeaders });
  const session = await getCustomerSession();
  if (!session || !session.mfaVerified) return NextResponse.json({ error: "unauthorized" }, { status: 401, headers: meHeaders });
  const parsed = input.safeParse(await request.json().catch(() => null));
  if (!parsed.success || !stripeConfigured()) return NextResponse.json({ error: "invalid" }, { status: 422, headers: meHeaders });
  const supabase = createAdminClient();
  const { data: reservation } = await supabase.from("reservations").select("id, number, status, rate_plan, total_cents").eq("number", parsed.data.number).eq("customer_id", session.customerId).maybeSingle();
  if (!reservation || !["REQUESTED", "PENDING_PAYMENT", "CONFIRMED"].includes(reservation.status)) return NextResponse.json({ error: "not_found" }, { status: 404, headers: meHeaders });
  const due = reservation.total_cents - (await paidRentalCents(reservation.id));
  if (due <= 0) return NextResponse.json({ ok: true, status: "already_paid" }, { headers: meHeaders });
  try {
    const result = await chargeSavedCard(reservation.id, { amountCents: due, description: "Rental payment", kind: "RENTAL", createdBy: null });
    if (result.status !== "succeeded") return NextResponse.json({ ok: false, error: result.status }, { headers: meHeaders });
    await confirmReservationAfterPayment(reservation.id, "payment");
    await audit({ actorUserId: session.userId, actorType: "CUSTOMER", action: "payment.succeeded", entityType: "reservation", entityId: reservation.id, metadata: { by: session.fullName, paymentId: result.paymentId, via: "website_saved_card", amountCents: due } });
    return NextResponse.json({ ok: true, status: "succeeded" }, { headers: meHeaders });
  } catch (cause) {
    return NextResponse.json({ ok: false, error: cause instanceof PaymentError ? cause.code : "failed" }, { headers: meHeaders });
  }
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: meHeaders });
}
