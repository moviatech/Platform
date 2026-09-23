import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { isLongTerm, renderAgreement, recordHints } from "@/features/portal/agreement";
import { AgreementDocument, SignatureBlock } from "@/features/portal/AgreementDocument";
import { recordBlocks, snapshotStructured } from "@/features/portal/agreement-record";
import { loadAgreementFacts } from "@/features/portal/agreement-facts";
import { getTrip } from "@/features/portal/queries";
import { SignForm } from "@/features/portal/TripControls";
import { requireCustomer } from "@/lib/auth/customer";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatFullDateTime } from "@/lib/utils/format";

export const metadata: Metadata = { title: "Rental agreement" };

type Props = { params: Promise<{ number: string }> };

export default async function AgreementPage({ params }: Props) {
  const session = await requireCustomer();
  const { number } = await params;
  if (!/^MV-[A-Z0-9]{6}$/.test(number)) notFound();
  const trip = await getTrip(session.customerId, number);
  if (!trip) notFound();

  const [t, locale] = await Promise.all([getTranslations("portal.agreement"), getLocale()]);
  const { data: latest } = await createAdminClient()
    .from("agreements")
    .select("terms_snapshot, signer_name, signed_at, template_version, signature_image, version, superseded_at")
    .eq("reservation_id", trip.id)
    .eq("customer_id", session.customerId)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  const marked = trip.agreement_state === "SIGNED";
  const signed = marked && latest && !latest.superseded_at ? latest : null;
  const previous = marked ? null : latest;

  const facts = signed ? null : await loadAgreementFacts(trip.id, locale);
  const rendered = facts ? renderAgreement(locale, facts) : null;
  const signable = !marked && !["CANCELLED", "NO_SHOW", "EXPIRED", "COMPLETED"].includes(trip.status);

  return (
    <>
      <Link href={`/trips/${trip.number}`} className="mb-4 inline-block text-[13px] text-muted hover:text-ink">
        ← {trip.number}
      </Link>
      <p className="eyebrow">{t("eyebrow")}</p>
      <h1 className="mt-2 mb-6 text-2xl font-semibold tracking-tight">{signed ? t("signedTitle") : t("title")}</h1>

      {previous && <p className="mb-4 rounded-xl bg-status-warning/10 px-4 py-3 text-sm">{t("resign", { at: formatFullDateTime(previous.signed_at) })}</p>}
      <div className="mb-4">
        <a href={`/trips/${trip.number}/agreement/pdf`} className="inline-flex h-10 items-center rounded-pill px-4 text-[13px] font-medium hairline hover:border-ink/25">
          {t("download")}
        </a>
      </div>
      <article className="card p-6 sm:p-8">
        {signed ? (
          <>
            <p className="mb-5 rounded-xl bg-status-available/10 px-4 py-3 text-sm">{t("signedBy", { name: signed.signer_name, at: formatFullDateTime(signed.signed_at), version: signed.template_version })}</p>
            {snapshotStructured(signed.template_version) ? (
              <AgreementDocument blocks={recordBlocks(signed.terms_snapshot, { image: signed.signature_image, rows: [[t("signer"), signed.signer_name], [t("signedAt"), formatFullDateTime(signed.signed_at)]] }, recordHints)} />
            ) : (
              <>
                <pre className="font-sans text-[14px] leading-relaxed whitespace-pre-wrap text-charcoal">{signed.terms_snapshot}</pre>
                <div className="mt-5">
                  <SignatureBlock image={signed.signature_image} rows={[[t("signer"), signed.signer_name], [t("signedAt"), formatFullDateTime(signed.signed_at)]]} />
                </div>
              </>
            )}
          </>
        ) : rendered ? (
          <AgreementDocument blocks={rendered.blocks} />
        ) : null}
      </article>

      {signable && rendered && (
        <section className="card mt-5 p-6 sm:p-8">
          <h2 className="mb-4 text-sm font-semibold">{t("signHeading")}</h2>
          <SignForm number={trip.number} defaultName={session.fullName} longTerm={isLongTerm(trip.rental_days)} mark={rendered.hash} lang={locale} />
        </section>
      )}
    </>
  );
}
