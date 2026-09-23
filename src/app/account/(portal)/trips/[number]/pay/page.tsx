import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { PayChoice } from "@/features/payments/PayChoice";
import { PaymentForm } from "@/features/payments/PaymentForm";
import { confirmReservationAfterPayment, createRentalPaymentIntent, createSetupIntentFor, finalizeCardSetup, PaymentError, settleRentalIntent } from "@/features/payments/service";
import { getTrip } from "@/features/portal/queries";
import { requireCustomer } from "@/lib/auth/customer";
import { stripeConfigured } from "@/lib/stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatMoney } from "@/lib/utils/format";

export const metadata: Metadata = { title: "Payment" };

type Query = { payment_intent?: string; setup_intent?: string; mode?: string };
type Props = { params: Promise<{ number: string }>; searchParams: Promise<Query> };

async function settleFromReturn(query: Query, trip: { id: string; rate_plan: string }, customerId: string) {
  if (query.payment_intent && /^pi_[A-Za-z0-9]+$/.test(query.payment_intent)) {
    try {
      const result = await settleRentalIntent(query.payment_intent, trip.id);
      if (result.status === "succeeded") return "paid";
    } catch {}
  }
  if (query.setup_intent && /^seti_[A-Za-z0-9]+$/.test(query.setup_intent)) {
    try {
      await finalizeCardSetup(query.setup_intent, customerId);
      if (trip.rate_plan === "PAY_LATER") await confirmReservationAfterPayment(trip.id, "card");
      return "card";
    } catch (cause) {
      if (!(cause instanceof PaymentError)) throw cause;
    }
  }
  return null;
}

export default async function PayPage({ params, searchParams }: Props) {
  const session = await requireCustomer();
  const { number } = await params;
  const query = await searchParams;
  if (!/^MV-[A-Z0-9]{6}$/.test(number)) notFound();
  const trip = await getTrip(session.customerId, number);
  if (!trip) notFound();
  if (!stripeConfigured()) redirect(`/trips/${number}?error=stripe_not_configured`);
  const settled = await settleFromReturn(query, trip, session.customerId);
  if (settled === "paid") redirect(`/trips/${number}?paid=1`);
  if (settled === "card") redirect(`/trips/${number}?card=saved`);

  const prepay = query.mode === "prepay" && trip.rate_plan === "PAY_LATER";
  const payNow = trip.rate_plan === "PAY_NOW" || prepay;
  if (!["REQUESTED", "PENDING_PAYMENT", "CONFIRMED"].includes(trip.status)) redirect(`/trips/${number}`);

  let clientSecret = "";
  let amountCents = 0;
  let discountCents = 0;
  let balance = false;
  let failure: string | null = null;
  try {
    if (payNow) {
      const intent = await createRentalPaymentIntent(trip.id, { prepay });
      clientSecret = intent.clientSecret;
      amountCents = intent.amountCents;
      discountCents = intent.discountCents;
      balance = intent.balance;
    } else {
      clientSecret = (await createSetupIntentFor(session.customerId)).clientSecret;
    }
  } catch (cause) {
    failure = cause instanceof PaymentError ? cause.code : "failed";
  }
  if (failure) redirect(`/trips/${number}?error=${failure}`);

  const [t, locale, { data: card }] = await Promise.all([getTranslations("portal.pay"), getLocale(), createAdminClient().from("customers").select("stripe_payment_method_id, stripe_card_last4").eq("id", session.customerId).maybeSingle()]);
  const savedLast4 = payNow && card?.stripe_payment_method_id && card.stripe_card_last4 ? card.stripe_card_last4 : null;
  const form = (
    <PaymentForm
      mode={payNow ? "payment" : "setup"}
      clientSecret={clientSecret}
      publishableKey={process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? ""}
      locale={locale === "zh" ? "zh" : "en"}
      number={number}
      amountCents={amountCents}
      returnPath={`/trips/${number}/pay${prepay ? "?mode=prepay" : ""}`}
      donePath={`/trips/${number}?${payNow ? "paid=1" : "card=saved"}`}
    />
  );

  return (
    <div className="mx-auto max-w-lg">
      <Link href={`/trips/${number}`} className="mb-4 inline-block text-[13px] text-muted hover:text-ink">
        ← {number}
      </Link>
      <h1 className="mt-2 mb-1 text-2xl font-semibold tracking-tight">{payNow ? t("payTitle") : t("cardTitle")}</h1>
      <p className="mb-6 text-sm text-muted">{prepay ? t("prepayLead", { amount: formatMoney(amountCents), discount: formatMoney(discountCents) }) : balance ? t("balanceLead", { amount: formatMoney(amountCents) }) : payNow ? t("payLead", { amount: formatMoney(amountCents) }) : t("cardLead")}</p>
      <section className="card p-6 sm:p-8">{savedLast4 ? <PayChoice number={number} last4={savedLast4} amountCents={amountCents} prepay={prepay} form={form} /> : form}</section>
    </div>
  );
}
