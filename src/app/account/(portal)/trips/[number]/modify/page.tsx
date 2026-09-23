import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/Badge";
import { loadActiveConfig } from "@/features/booking/service";
import { bookingSlots, zonedParts } from "@/features/booking/time";
import { listChangeRequests } from "@/features/portal/change-queries";
import { ModifyForm } from "@/features/portal/ModifyForm";
import { getTrip } from "@/features/portal/queries";
import { requireCustomer } from "@/lib/auth/customer";
import { formatDateTime, formatFullDateTime } from "@/lib/utils/format";

export const metadata: Metadata = { title: "Modify booking" };

type Props = { params: Promise<{ number: string }>; searchParams: Promise<{ action?: string }> };

const actionKinds: Record<string, string> = { extend: "extend", "return-time": "schedule", "add-driver": "driver", schedule: "schedule" };

export default async function ModifyPage({ params, searchParams }: Props) {
  const session = await requireCustomer();
  const { number } = await params;
  const { action } = await searchParams;
  if (!/^MV-[A-Z0-9]{6}$/.test(number)) notFound();
  const trip = await getTrip(session.customerId, number);
  if (!trip) notFound();
  if (!["REQUESTED", "PENDING_PAYMENT", "CONFIRMED", "ACTIVE"].includes(trip.status)) redirect(`/trips/${number}`);

  const [t, types, statuses, locale, config, requests] = await Promise.all([
    getTranslations("portal.modify"),
    getTranslations("portal.help.types"),
    getTranslations("portal.modify.status"),
    getLocale(),
    loadActiveConfig(),
    listChangeRequests(trip.id, session.customerId),
  ]);
  const zone = "America/Los_Angeles";
  const pickup = zonedParts(trip.pickup_at, zone);
  const dropoff = zonedParts(trip.return_at, zone);
  const className = locale === "zh" ? (trip.vehicle_class?.name_zh ?? trip.vehicle_class?.name) : trip.vehicle_class?.name;

  return (
    <>
      <Link href={`/trips/${trip.number}`} className="mb-4 inline-block text-[13px] text-muted hover:text-ink">
        ← {trip.number}
      </Link>
      <p className="eyebrow">{t("eyebrow")}</p>
      <h1 className="mt-2 mb-1 text-2xl font-semibold tracking-tight">{t("title")}</h1>
      <p className="mb-6 text-[14px] text-muted">
        {className} · {formatFullDateTime(trip.pickup_at, locale)} → {formatFullDateTime(trip.return_at, locale)}
      </p>
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <section className="card p-6 sm:p-8">
          <ModifyForm number={trip.number} defaultKind={actionKinds[action ?? ""] ?? action} current={{ pickupDate: pickup.date, pickupTime: pickup.time, returnDate: dropoff.date, returnTime: dropoff.time }} slots={bookingSlots(config.data.bookingWindow)} />
        </section>
        <section className="card h-fit p-5">
          <h2 className="text-sm font-semibold">{t("history")}</h2>
          {requests.length === 0 ? (
            <p className="mt-3 text-[13px] text-muted">{t("noHistory")}</p>
          ) : (
            <ul className="mt-3 flex flex-col divide-y divide-ink/[0.06]">
              {requests.map((request) => (
                <li key={request.id} className="py-2.5 text-[13px]">
                  <span className="flex items-center justify-between gap-2">
                    <span className="font-medium">{types.has(request.kind) ? types(request.kind) : request.kind}</span>
                    <Badge tone={request.status === "APPROVED" ? "success" : request.status === "DECLINED" ? "danger" : "warning"}>{statuses(request.status)}</Badge>
                  </span>
                  <span className="block text-xs text-muted">{formatDateTime(request.created_at, locale)}</span>
                  {request.staff_note && <span className="mt-1 block text-charcoal">{request.staff_note}</span>}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}
