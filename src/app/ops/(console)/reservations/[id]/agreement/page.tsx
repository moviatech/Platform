import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { BackLink, safeBack } from "@/components/ops/BackLink";
import { PageHeader } from "@/components/ops/PageHeader";
import { SignatureBlock } from "@/features/portal/AgreementDocument";
import { requirePagePermission } from "@/lib/auth/staff";
import { createClient } from "@/lib/supabase/server";
import { formatFullDateTime } from "@/lib/utils/format";

export const metadata: Metadata = { title: "Agreement" };

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ back?: string }> };

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function OpsAgreementPage({ params, searchParams }: Props) {
  await requirePagePermission("reservation.view");
  const { id } = await params;
  const { back } = await searchParams;
  if (!uuid.test(id)) notFound();

  const supabase = await createClient();
  const { data } = await supabase
    .from("agreements")
    .select("terms_snapshot, terms_hash, signer_name, signer_ip, user_agent, signed_at, template_version, locale, signature_image, version, superseded_at, reservation:reservations(number)")
    .eq("reservation_id", id)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) notFound();
  const agreement = data as unknown as { terms_snapshot: string; terms_hash: string; signer_name: string; signer_ip: string | null; user_agent: string | null; signed_at: string; template_version: string; locale: string; signature_image: string | null; version: number; superseded_at: string | null; reservation: { number: string } | null };

  const [t, locale] = await Promise.all([getTranslations("reservations"), getLocale()]);
  return (
    <>
      <BackLink href={safeBack(back, `/reservations/${id}`)} />
      <PageHeader eyebrow={agreement.reservation?.number} title={t("detail.agreement")} />
      <section className="card mb-5 p-5 text-[13px]">
        <dl className="grid gap-x-8 gap-y-2 sm:grid-cols-2">
          <div className="flex justify-between gap-4"><dt className="text-muted">{t("agreementView.signer")}</dt><dd>{agreement.signer_name}</dd></div>
          <div className="flex justify-between gap-4"><dt className="text-muted">{t("agreementView.signedAt")}</dt><dd>{formatFullDateTime(agreement.signed_at, locale)}</dd></div>
          <div className="flex justify-between gap-4"><dt className="text-muted">{t("agreementView.version")}</dt><dd>{agreement.template_version} · {agreement.locale} · #{agreement.version}{agreement.superseded_at ? ` · ${t("agreementView.superseded")}` : ""}</dd></div>
          <div className="flex justify-between gap-4"><dt className="text-muted">IP</dt><dd className="font-mono text-[12px]">{agreement.signer_ip ?? "—"}</dd></div>
          <div className="flex justify-between gap-4 sm:col-span-2"><dt className="text-muted">SHA-256</dt><dd className="truncate font-mono text-[12px]">{agreement.terms_hash}</dd></div>
          <div className="flex justify-between gap-4 sm:col-span-2"><dt className="text-muted">User agent</dt><dd className="truncate text-[12px]">{agreement.user_agent ?? "—"}</dd></div>
        </dl>
      </section>
      <article className="card p-6 sm:p-8">
        <pre className="font-sans text-[14px] leading-relaxed whitespace-pre-wrap text-charcoal">{agreement.terms_snapshot}</pre>
        <div className="mt-5">
          <SignatureBlock image={agreement.signature_image} rows={[[t("agreementView.signer"), agreement.signer_name], [t("agreementView.signedAt"), formatFullDateTime(agreement.signed_at, locale)]]} />
        </div>
      </article>
    </>
  );
}
