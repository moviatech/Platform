import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import { BackLink } from "@/components/ops/BackLink";
import { PageHeader } from "@/components/ops/PageHeader";
import { AgreementDocument } from "@/features/portal/AgreementDocument";
import { renderAgreement } from "@/features/portal/agreement";
import { loadTemplateFacts } from "@/features/portal/agreement-facts";
import { requirePagePermission } from "@/lib/auth/staff";

export const metadata: Metadata = { title: "Agreement" };

export default async function AgreementTemplatePage() {
  await requirePagePermission("reservation.view");
  const [t, locale, facts] = await Promise.all([getTranslations("reservations"), getLocale(), loadTemplateFacts()]);
  const rendered = renderAgreement(locale, facts, undefined, true);
  return (
    <>
      <BackLink href="/reservations" />
      <PageHeader title={t("template")} />
      <article className="card p-6 sm:p-8">
        <AgreementDocument blocks={rendered.blocks} />
      </article>
    </>
  );
}
