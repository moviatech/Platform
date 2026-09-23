import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getTranslations } from "next-intl/server";
import { BackLink } from "@/components/ops/BackLink";
import { PageHeader } from "@/components/ops/PageHeader";
import { OpsSignForm } from "@/features/handover/HandoverForms";
import { isLongTerm, renderAgreement } from "@/features/portal/agreement";
import { AgreementDocument } from "@/features/portal/AgreementDocument";
import { loadAgreementFacts } from "@/features/portal/agreement-facts";
import { getReservation } from "@/features/reservations/queries";
import { defaultLocale, isLocale, locales, type Locale } from "@/i18n/config";
import { loadMessages } from "@/i18n/messages";
import { requirePagePermission } from "@/lib/auth/staff";
import { createAdminClient } from "@/lib/supabase/admin";
import { cn } from "@/lib/utils/cn";

export const metadata: Metadata = { title: "Sign agreement" };

type Props = { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const languageNames: Record<Locale, string> = { zh: "中文", en: "English" };

export default async function SignPage({ params, searchParams }: Props) {
  await requirePagePermission("vehicle.inspect");
  const { id } = await params;
  if (!uuid.test(id)) notFound();
  const reservation = await getReservation(id);
  if (!reservation) notFound();
  if (reservation.agreement_state === "SIGNED") redirect(`/reservations/${id}/agreement`);
  if (["CANCELLED", "NO_SHOW", "EXPIRED", "COMPLETED"].includes(reservation.status)) redirect(`/reservations/${id}`);

  const [t, uiLocale, search, { data: customer }] = await Promise.all([
    getTranslations("handover"),
    getLocale(),
    searchParams,
    reservation.customer ? createAdminClient().from("customers").select("preferred_language").eq("id", reservation.customer.id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const asked = typeof search.lang === "string" ? search.lang : undefined;
  const preferred = (customer as { preferred_language: string | null } | null)?.preferred_language ?? undefined;
  const lang: Locale = isLocale(asked) ? asked : isLocale(preferred) ? preferred : isLocale(uiLocale) ? uiLocale : defaultLocale;
  const facts = await loadAgreementFacts(id, lang);
  if (!facts) notFound();
  const rendered = renderAgreement(lang, facts, undefined, false, "device");
  const form = <OpsSignForm reservationId={id} lang={lang} defaultName={reservation.customer?.full_name ?? ""} longTerm={isLongTerm(reservation.rental_days)} mark={rendered.hash} />;

  return (
    <>
      <BackLink href={`/reservations/${id}/pickup`} />
      <PageHeader eyebrow={reservation.number} title={t("sign")} />
      <nav className="mb-4 flex gap-2">
        {locales.map((code) => (
          <Link key={code} href={`/reservations/${id}/sign?lang=${code}`} aria-current={code === lang ? "page" : undefined} className={cn("rounded-pill px-3.5 py-1.5 text-[13px] hairline hover:border-ink/25", code === lang && "bg-ink text-white")}>
            {languageNames[code]}
          </Link>
        ))}
      </nav>
      <article className="card p-6 sm:p-8" lang={lang}>
        <AgreementDocument blocks={rendered.blocks} />
      </article>
      <section className="card mt-5 p-6 sm:p-8" lang={lang}>
        {lang === uiLocale ? (
          form
        ) : (
          <NextIntlClientProvider locale={lang} messages={await loadMessages(lang)}>
            {form}
          </NextIntlClientProvider>
        )}
      </section>
    </>
  );
}
