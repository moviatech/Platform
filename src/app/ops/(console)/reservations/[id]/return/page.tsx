import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { BackLink } from "@/components/ops/BackLink";
import { PageHeader } from "@/components/ops/PageHeader";
import { ReturnForm } from "@/features/handover/HandoverForms";
import { InspectionSummary } from "@/features/handover/InspectionSummary";
import { listClaims, signedOnsite } from "@/features/claims/service";
import { SelfServicePanel } from "@/features/selfservice/SelfServicePanel";
import { loadSelfService } from "@/features/selfservice/service";
import { listInspections, loadReturnParams } from "@/features/handover/queries";
import { getReservation } from "@/features/reservations/queries";
import { superchargingFor, teslaReady } from "@/features/tesla/service";
import { requirePagePermission } from "@/lib/auth/staff";
import { r2Configured } from "@/lib/media/r2";
import { formatFullDateTime } from "@/lib/utils/format";

export const metadata: Metadata = { title: "Return" };

type Props = { params: Promise<{ id: string }> };

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function ReturnPage({ params }: Props) {
  const staff = await requirePagePermission("vehicle.inspect");
  const { id } = await params;
  if (!uuid.test(id)) notFound();
  const reservation = await getReservation(id);
  if (!reservation) notFound();
  if (reservation.status !== "ACTIVE") redirect(`/reservations/${id}`);

  const [t, params_, inspections, claims] = await Promise.all([getTranslations("handover"), loadReturnParams(id), listInspections(id), listClaims(id)]);
  const signed = claims.filter(signedOnsite);
  const signedDamage = signed.length ? { cents: signed.reduce((sum, claim) => sum + claim.amount_cents, 0), notes: signed[0].description ?? "", unpaidCents: signed.filter((claim) => claim.status === "CONSENTED").reduce((sum, claim) => sum + claim.amount_cents, 0) } : null;
  if (!params_) notFound();
  const tesla = params_.vin ? await teslaReady() : false;
  const lookup = tesla ? await superchargingFor(id).then((value) => ({ value }), () => null) : { value: null };
  const returnParams = { ...params_, vin: tesla ? params_.vin : null, superchargingCents: lookup?.value?.cents ?? 0, superchargingSessions: lookup?.value?.sessions ?? 0, superchargingUnknown: lookup === null };
  const selfService = reservation.pickup_method === "SELF_SERVICE" ? await loadSelfService(id) : null;

  return (
    <>
      <BackLink href={`/reservations/${id}`} />
      <PageHeader eyebrow={reservation.number} title={t("return")} lead={`${reservation.customer?.full_name ?? ""} · ${formatFullDateTime(reservation.return_at)}`} />
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="flex flex-col gap-5">
          {selfService && <SelfServicePanel row={selfService} canEdit={staff.permissions.has("reservation.edit")} />}
          <InspectionSummary records={inspections.filter((record) => record.kind === "PICKUP")} />
        </div>
        <section className="card p-6">
          <ReturnForm reservationId={id} params={returnParams} hasChildSeat={reservation.add_ons.includes("childSeat")} videoEnabled={r2Configured()} customerName={reservation.customer?.full_name ?? ""} signedDamage={signedDamage} />
        </section>
      </div>
    </>
  );
}
