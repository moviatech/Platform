import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { BackLink, safeBack } from "@/components/ops/BackLink";
import { PageHeader } from "@/components/ops/PageHeader";
import { AgreementDocument, SignatureBlock } from "@/features/portal/AgreementDocument";
import { renderAgreement, recordHints } from "@/features/portal/agreement";
import { recordBlocks, snapshotStructured } from "@/features/portal/agreement-record";
import { loadAgreementFacts } from "@/features/portal/agreement-facts";
import { activeLink, linkUrl } from "@/features/portal/agreement-link";
import { getReservation } from "@/features/reservations/queries";
import { SignLinkPanel } from "@/features/reservations/SignLinkPanel";
import { SpecialTermsForm } from "@/features/reservations/SpecialTermsForm";
import { can, requirePagePermission } from "@/lib/auth/staff";
import { createClient } from "@/lib/supabase/server";
import { formatFullDateTime } from "@/lib/utils/format";

export const metadata: Metadata = { title: "Agreement" };

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ back?: string }> };

type AgreementRecord = {
  terms_snapshot: string;
  terms_hash: string;
  signer_name: string;
  signer_ip: string | null;
  user_agent: string | null;
  signed_at: string;
  template_version: string;
  locale: string;
  signature_image: string | null;
  version: number;
  superseded_at: string | null;
};

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const closedStatuses = ["COMPLETED", "CANCELLED", "NO_SHOW", "EXPIRED"];
const pdfLink = "inline-flex h-8 items-center rounded-pill px-3.5 text-[13px] font-medium hairline hover:border-ink/25";

export default async function OpsAgreementPage({ params, searchParams }: Props) {
  const session = await requirePagePermission("reservation.view");
  const { id } = await params;
  const { back } = await searchParams;
  if (!uuid.test(id)) notFound();

  const supabase = await createClient();
  const [{ data }, t, locale, reservation] = await Promise.all([
    supabase
      .from("agreements")
      .select("terms_snapshot, terms_hash, signer_name, signer_ip, user_agent, signed_at, template_version, locale, signature_image, version, superseded_at")
      .eq("reservation_id", id)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle(),
    getTranslations("reservations"),
    getLocale(),
    getReservation(id),
  ]);
  if (!reservation) notFound();
  const agreement = data as AgreementRecord | null;
  const signed = reservation.agreement_state === "SIGNED";
  const linkable = can(session, "reservation.edit") && !["CANCELLED", "NO_SHOW", "EXPIRED"].includes(reservation.status);
  const current = linkable ? await activeLink(id) : null;
  const tools = (
    <section className="card mb-5 flex flex-col gap-4 p-5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="mr-1 text-[13px] text-muted">{t("agreementView.pdf")}</span>
        <a href={`/reservations/${id}/agreement/pdf?lang=zh`} className={pdfLink}>
          中文
        </a>
        <a href={`/reservations/${id}/agreement/pdf?lang=en`} className={pdfLink}>
          English
        </a>
      </div>
      {linkable && (
        <div className="flex flex-col gap-2">
          <span className="text-[13px] text-muted">{t("agreementView.signLink")}</span>
          <SignLinkPanel reservationId={id} current={current ? { url: linkUrl(current.id), expires: formatFullDateTime(current.expiresAt) } : null} />
        </div>
      )}
    </section>
  );

  const record = agreement && (
    <>
      <section className="card mb-5 p-5 text-[13px]">
        <dl className="grid gap-x-8 gap-y-2 sm:grid-cols-2">
          <div className="flex justify-between gap-4"><dt className="text-muted">{t("agreementView.signer")}</dt><dd>{agreement.signer_name}</dd></div>
          <div className="flex justify-between gap-4"><dt className="text-muted">{t("agreementView.signedAt")}</dt><dd>{formatFullDateTime(agreement.signed_at)}</dd></div>
          <div className="flex justify-between gap-4"><dt className="text-muted">{t("agreementView.version")}</dt><dd>{agreement.template_version} · {agreement.locale} · #{agreement.version}{agreement.superseded_at ? ` · ${t("agreementView.superseded")}` : ""}</dd></div>
          <div className="flex justify-between gap-4"><dt className="text-muted">IP</dt><dd className="font-mono text-[12px]">{agreement.signer_ip ?? "—"}</dd></div>
          <div className="flex justify-between gap-4 sm:col-span-2"><dt className="text-muted">SHA-256</dt><dd className="truncate font-mono text-[12px]">{agreement.terms_hash}</dd></div>
          <div className="flex justify-between gap-4 sm:col-span-2"><dt className="text-muted">User agent</dt><dd className="truncate text-[12px]">{agreement.user_agent ?? "—"}</dd></div>
        </dl>
      </section>
      <article className="card p-6 sm:p-8">
        {snapshotStructured(agreement.template_version) ? (
          <AgreementDocument blocks={recordBlocks(agreement.terms_snapshot, { image: agreement.signature_image, rows: [[t("agreementView.signer"), agreement.signer_name], [t("agreementView.signedAt"), formatFullDateTime(agreement.signed_at)]] }, recordHints)} />
        ) : (
          <>
            <pre className="font-sans text-[14px] leading-relaxed whitespace-pre-wrap text-charcoal">{agreement.terms_snapshot}</pre>
            <div className="mt-5">
              <SignatureBlock image={agreement.signature_image} rows={[[t("agreementView.signer"), agreement.signer_name], [t("agreementView.signedAt"), formatFullDateTime(agreement.signed_at)]]} />
            </div>
          </>
        )}
      </article>
    </>
  );

  if (agreement && signed && !agreement.superseded_at) {
    return (
      <>
        <BackLink href={safeBack(back, `/reservations/${id}`)} />
        <PageHeader eyebrow={reservation.number} title={t("detail.agreement")} />
        {tools}
        {record}
      </>
    );
  }

  const facts = await loadAgreementFacts(id, locale);
  if (!facts) notFound();
  const rendered = renderAgreement(locale, facts);
  const editable = !signed && can(session, "reservation.edit") && !closedStatuses.includes(reservation.status);

  return (
    <>
      <BackLink href={safeBack(back, `/reservations/${id}`)} />
      <PageHeader eyebrow={reservation.number} title={t("detail.agreement")} />
      <p className="mb-4 rounded-xl bg-status-warning/10 px-4 py-3 text-[13px]">{signed ? t("agreementView.manualOnly") : t("agreementView.previewOnly")}</p>
      {tools}
      {editable && (
        <section className="card mb-5 p-6">
          <h2 className="mb-3 text-sm font-semibold">{t("specialTerms.title")}</h2>
          <SpecialTermsForm reservationId={id} zh={reservation.special_terms_zh ?? ""} en={reservation.special_terms ?? ""} />
        </section>
      )}
      <article className="card p-6 sm:p-8">
        <AgreementDocument blocks={rendered.blocks} />
      </article>
      {agreement && (
        <details className="mt-5 text-[13px]">
          <summary className="cursor-pointer px-1 py-2 text-muted hover:text-ink">{t("agreementView.previous", { at: formatFullDateTime(agreement.signed_at) })}</summary>
          <div className="mt-3">{record}</div>
        </details>
      )}
    </>
  );
}
