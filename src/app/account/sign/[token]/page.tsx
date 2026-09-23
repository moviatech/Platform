import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { createTranslator, NextIntlClientProvider } from "next-intl";
import { getLocale } from "next-intl/server";
import type { ReactNode } from "react";
import { Logo } from "@/components/ui/Logo";
import { isLongTerm, renderAgreement, recordHints } from "@/features/portal/agreement";
import { AgreementDocument, SignatureBlock } from "@/features/portal/AgreementDocument";
import { recordBlocks, snapshotStructured } from "@/features/portal/agreement-record";
import { loadAgreementFacts } from "@/features/portal/agreement-facts";
import { resolveLink } from "@/features/portal/agreement-link";
import { closedForSigning } from "@/features/portal/sign-core";
import { EmailCopyForm, SignForm } from "@/features/portal/TripControls";
import { defaultLocale, isLocale, locales, type Locale } from "@/i18n/config";
import { loadMessages } from "@/i18n/messages";
import { createAdminClient } from "@/lib/supabase/admin";
import { cn } from "@/lib/utils/cn";
import { formatFullDateTime } from "@/lib/utils/format";

export const metadata: Metadata = { title: "Rental agreement" };

type Props = { params: Promise<{ token: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

const languageNames: Record<Locale, string> = { zh: "中文", en: "English" };
const action = "inline-flex h-10 items-center rounded-pill px-4 text-[13px] font-medium hairline hover:border-ink/25";

function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-dvh bg-[#fafaf8] px-4 py-10">
      <div className="mx-auto w-full max-w-3xl">
        <div className="mb-6 flex justify-center">
          <Logo />
        </div>
        {children}
      </div>
    </div>
  );
}

export default async function SignLinkPage({ params, searchParams }: Props) {
  const [{ token }, search, uiLocale] = await Promise.all([params, searchParams, getLocale()]);
  const link = await resolveLink(token);
  if (!link) notFound();
  const asked = typeof search.lang === "string" ? search.lang : undefined;
  const fallback: Locale = isLocale(uiLocale) ? uiLocale : defaultLocale;

  if (link.state === "expired") {
    const locale = isLocale(asked) ? asked : fallback;
    const t = createTranslator({ locale, messages: await loadMessages(locale), namespace: "portal.signLink" });
    return (
      <Shell>
        <p className="card p-6 text-sm sm:p-8">{t("expired")}</p>
      </Shell>
    );
  }

  const reservation = link.reservation;
  const preferred = reservation.customer?.preferred_language ?? undefined;
  const lang: Locale = isLocale(asked) ? asked : isLocale(preferred) ? preferred : fallback;
  const [messages, { data: latest }] = await Promise.all([
    loadMessages(lang),
    createAdminClient()
      .from("agreements")
      .select("terms_snapshot, signer_name, signed_at, template_version, signature_image, superseded_at")
      .eq("reservation_id", reservation.id)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  const t = createTranslator({ locale: lang, messages, namespace: "portal.signLink" });
  const a = createTranslator({ locale: lang, messages, namespace: "portal.agreement" });
  const marked = reservation.agreement_state === "SIGNED";
  const signed = marked && latest && !latest.superseded_at ? latest : null;
  const previous = marked ? null : latest;
  const closed = closedForSigning.includes(reservation.status);

  if (closed && !signed) {
    return (
      <Shell>
        <p className="card p-6 text-sm sm:p-8">{t("closed", { number: reservation.number })}</p>
      </Shell>
    );
  }

  const facts = signed ? null : await loadAgreementFacts(reservation.id, lang);
  const rendered = facts ? renderAgreement(lang, facts) : null;
  const signable = !marked && Boolean(rendered);
  const pdfHref = `/sign/${token}/pdf?lang=${lang}`;
  const provide = (node: ReactNode) =>
    lang === uiLocale ? (
      node
    ) : (
      <NextIntlClientProvider locale={lang} messages={messages}>
        {node}
      </NextIntlClientProvider>
    );

  return (
    <Shell>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="eyebrow">{reservation.number}</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">{signed ? a("signedTitle") : a("title")}</h1>
        </div>
        <nav className="flex gap-2">
          {locales.map((code) => (
            <Link key={code} href={`/sign/${token}?lang=${code}`} aria-current={code === lang ? "page" : undefined} className={cn("rounded-pill px-3.5 py-1.5 text-[13px] hairline hover:border-ink/25", code === lang && "bg-ink text-white")}>
              {languageNames[code]}
            </Link>
          ))}
        </nav>
      </div>

      {previous && <p className="mb-4 rounded-xl bg-status-warning/10 px-4 py-3 text-sm">{a("resign", { at: formatFullDateTime(previous.signed_at) })}</p>}
      {marked && !signed && <p className="mb-4 rounded-xl bg-status-available/10 px-4 py-3 text-sm">{a("signed")}</p>}
      {signed && <p className="mb-4 rounded-xl bg-status-available/10 px-4 py-3 text-sm">{a("signedBy", { name: signed.signer_name, at: formatFullDateTime(signed.signed_at), version: signed.template_version })}</p>}

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <a href={pdfHref} className={action}>
          {t("download")}
        </a>
        {signed && reservation.customer?.email && provide(<EmailCopyForm token={token} lang={lang} />)}
      </div>

      <article className="card p-6 sm:p-8" lang={lang}>
        {signed ? (
          snapshotStructured(signed.template_version) ? (
            <AgreementDocument blocks={recordBlocks(signed.terms_snapshot, { image: signed.signature_image, rows: [[a("signer"), signed.signer_name], [a("signedAt"), formatFullDateTime(signed.signed_at)]] }, recordHints)} />
          ) : (
            <>
              <pre className="font-sans text-[14px] leading-relaxed whitespace-pre-wrap text-charcoal">{signed.terms_snapshot}</pre>
              <div className="mt-5">
                <SignatureBlock image={signed.signature_image} rows={[[a("signer"), signed.signer_name], [a("signedAt"), formatFullDateTime(signed.signed_at)]]} />
              </div>
            </>
          )
        ) : rendered ? (
          <AgreementDocument blocks={rendered.blocks} />
        ) : null}
      </article>

      {signable && rendered && (
        <section className="card mt-5 p-6 sm:p-8" lang={lang}>
          <h2 className="mb-4 text-sm font-semibold">{a("signHeading")}</h2>
          {provide(<SignForm number={reservation.number} token={token} defaultName={reservation.customer?.full_name ?? ""} longTerm={isLongTerm(reservation.rental_days)} mark={rendered.hash} lang={lang} />)}
        </section>
      )}
      <p className="mt-5 text-center text-[12px] text-muted">{t("validUntil", { at: formatFullDateTime(link.expiresAt) })}</p>
    </Shell>
  );
}
