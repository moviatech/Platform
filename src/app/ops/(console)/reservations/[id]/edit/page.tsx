import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { BackLink } from "@/components/ops/BackLink";
import { PageHeader } from "@/components/ops/PageHeader";
import { listClasses, loadActiveConfig } from "@/features/booking/service";
import { bookingSlots, zonedParts } from "@/features/booking/time";
import { EditForm } from "@/features/reservations/EditForm";
import { getReservation } from "@/features/reservations/queries";
import { requirePagePermission } from "@/lib/auth/staff";

export const metadata: Metadata = { title: "Edit reservation" };

type Props = { params: Promise<{ id: string }> };

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function EditReservationPage({ params }: Props) {
  await requirePagePermission("reservation.edit");
  const { id } = await params;
  if (!uuid.test(id)) notFound();
  const reservation = await getReservation(id);
  if (!reservation) notFound();
  if (!["REQUESTED", "PENDING_PAYMENT", "CONFIRMED"].includes(reservation.status)) redirect(`/reservations/${id}`);

  const [t, locale, classes, config] = await Promise.all([getTranslations("reservations"), getLocale(), listClasses(), loadActiveConfig()]);
  const zone = "America/Los_Angeles";
  const pickup = zonedParts(reservation.pickup_at, zone);
  const dropoff = zonedParts(reservation.return_at, zone);
  const current = {
    classSlug: classes.find((item) => item.id === reservation.class_id)?.slug ?? classes[0]?.slug ?? "",
    pickupDate: pickup.date,
    pickupTime: pickup.time,
    returnDate: dropoff.date,
    returnTime: dropoff.time,
    protection: reservation.protection,
    addOns: reservation.add_ons,
    ageBand: reservation.driver_age_band,
    pickupMethod: reservation.pickup_method,
    deliveryAddress: reservation.delivery_address ?? "",
    totalCents: reservation.total_cents,
  };

  return (
    <>
      <BackLink href={`/reservations/${id}`} />
      <PageHeader eyebrow={reservation.number} title={t("edit.title")} />
      <section className="card max-w-3xl p-6">
        <EditForm
          reservationId={id}
          current={current}
          classes={classes.map((item) => ({ slug: item.slug, name: locale === "zh" ? (item.name_zh ?? item.name) : item.name }))}
          protections={config.data.protectionPlans.map((plan) => plan.id)}
          addOns={config.data.addOns.map((item) => item.id)}
          slots={bookingSlots(config.data.bookingWindow)}
        />
      </section>
    </>
  );
}
