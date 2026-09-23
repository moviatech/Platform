import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { PaymentForm } from "@/features/payments/PaymentForm";
import { createSetupIntentFor, finalizeCardSetup, PaymentError } from "@/features/payments/service";
import { requireCustomer } from "@/lib/auth/customer";
import { stripeConfigured } from "@/lib/stripe";

export const metadata: Metadata = { title: "Card" };

type Props = { searchParams: Promise<{ setup_intent?: string }> };

async function settleFromReturn(setupIntentId: string | undefined, customerId: string) {
  if (!setupIntentId || !/^seti_[A-Za-z0-9]+$/.test(setupIntentId)) return false;
  try {
    await finalizeCardSetup(setupIntentId, customerId);
    return true;
  } catch (cause) {
    if (cause instanceof PaymentError) return false;
    throw cause;
  }
}

export default async function CardPage({ searchParams }: Props) {
  const session = await requireCustomer();
  const query = await searchParams;
  if (!stripeConfigured()) redirect("/account?card=unavailable");
  if (await settleFromReturn(query.setup_intent, session.customerId)) redirect("/account?card=saved");

  let clientSecret = "";
  try {
    clientSecret = (await createSetupIntentFor(session.customerId)).clientSecret;
  } catch {
    clientSecret = "";
  }
  if (!clientSecret) redirect("/account?card=unavailable");

  const [t, locale] = await Promise.all([getTranslations("portal.pay"), getLocale()]);

  return (
    <div className="mx-auto max-w-lg">
      <Link href="/account" className="mb-4 inline-block text-[13px] text-muted hover:text-ink">
        ← {t("backAccount")}
      </Link>
      <h1 className="mt-2 mb-1 text-2xl font-semibold tracking-tight">{t("cardTitle")}</h1>
      <p className="mb-6 text-sm text-muted">{t("cardLead")}</p>
      <section className="card p-6 sm:p-8">
        <PaymentForm mode="setup" clientSecret={clientSecret} publishableKey={process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? ""} locale={locale === "zh" ? "zh" : "en"} returnPath="/account/card" donePath="/account?card=saved" />
      </section>
    </div>
  );
}
