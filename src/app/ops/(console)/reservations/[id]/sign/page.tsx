import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { BackLink } from "@/components/ops/BackLink";
import { PageHeader } from "@/components/ops/PageHeader";
import { OpsSignForm } from "@/features/handover/HandoverForms";
import { renderAgreement } from "@/features/portal/agreement";
import { AgreementDocument } from "@/features/portal/AgreementDocument";
import { loadAgreementFacts } from "@/features/portal/agreement-facts";
import { getReservation } from "@/features/reservations/queries";
import { requirePagePermission } from "@/lib/auth/staff";

export const metadata: Metadata = { title: "Sign agreement" };

type Props = { params: Promise<{ id: string }> };

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function SignPage({ params }: Props) {
  await requirePagePermission("reservation.edit");
  const { id } = await params;
  if (!uuid.test(id)) notFound();
  const reservation = await getReservation(id);
  if (!reservation) notFound();
  if (reservation.agreement_state === "SIGNED") redirect(`/reservations/${id}/agreement`);
  if (["CANCELLED", "NO_SHOW", "EXPIRED", "COMPLETED"].includes(reservation.status)) redirect(`/reservations/${id}`);

  const [t, locale] = await Promise.all([getTranslations("handover"), getLocale()]);
  const facts = await loadAgreementFacts(id, locale);
  if (!facts) notFound();
  const rendered = renderAgreement(locale, facts);

  return (
    <>
      <BackLink href={`/reservations/${id}/pickup`} />
      <PageHeader eyebrow={reservation.number} title={t("sign")} />
      <article className="card p-6 sm:p-8">
        <AgreementDocument blocks={rendered.blocks} />
      </article>
      <section className="card mt-5 p-6 sm:p-8">
        <OpsSignForm reservationId={id} defaultName={reservation.customer?.full_name ?? ""} />
      </section>
    </>
  );
}
