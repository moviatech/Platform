import "server-only";
import { portalOrigin } from "@/lib/env";
import { signedId } from "@/lib/signed-id";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkoutCurrent } from "./balance";
import { rentalKinds } from "./charge-line";
import { paidRentalCents } from "./service";

const signed = signedId("pay-link", 8);
const closedOrders = ["CANCELLED", "EXPIRED", "NO_SHOW"];

export const payToken = signed.token;
export const payUrl = (paymentId: string) => `${portalOrigin}/pay/${signed.token(paymentId)}`;

export type PayLink = { state: "open"; url: string } | { state: "done" } | { state: "gone" };

type Row = {
  status: string;
  amount_cents: number;
  reservation_id: string;
  checkout_url: string | null;
  checkout_expires_at: string | null;
  stripe_checkout_session_id: string | null;
  stripe_payment_intent_id: string | null;
  reservation: { status: string; rate_plan: string; total_cents: number } | null;
};

function hosted(url: string) {
  try {
    const target = new URL(url);
    return target.protocol === "https:" && (target.hostname === "stripe.com" || target.hostname.endsWith(".stripe.com"));
  } catch {
    return false;
  }
}

export async function resolvePayLink(token: string): Promise<PayLink | null> {
  const id = signed.id(token);
  if (!id) return null;
  const { data } = await createAdminClient()
    .from("payments")
    .select("status, amount_cents, reservation_id, checkout_url, checkout_expires_at, stripe_checkout_session_id, stripe_payment_intent_id, reservation:reservations(status, rate_plan, total_cents)")
    .eq("id", id)
    .maybeSingle();
  const row = data as unknown as Row | null;
  const reservation = row?.reservation;
  if (!row || !reservation || !row.stripe_checkout_session_id) return null;
  if (closedOrders.includes(reservation.status) || ["CANCELLED", "REFUNDED"].includes(row.status)) return { state: "gone" };
  if (["SUCCEEDED", "PARTIALLY_REFUNDED"].includes(row.status)) return { state: "done" };
  if (!row.checkout_url) return { state: row.status === "PENDING" && row.stripe_payment_intent_id ? "done" : "gone" };
  if (!row.checkout_expires_at || Date.parse(row.checkout_expires_at) <= Date.now() || !hosted(row.checkout_url)) return { state: "gone" };
  const payNow = reservation.rate_plan === "PAY_NOW";
  const dueCents = payNow && row.amount_cents > 0 ? reservation.total_cents - (await paidRentalCents(row.reservation_id, rentalKinds)) : 0;
  if (checkoutCurrent(row.amount_cents, payNow, dueCents)) return { state: "open", url: row.checkout_url };
  return { state: payNow && dueCents <= 0 ? "done" : "gone" };
}
