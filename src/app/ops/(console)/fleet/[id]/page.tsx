import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/Badge";
import { BackLink, safeBack, withBack } from "@/components/ops/BackLink";
import { PageHeader } from "@/components/ops/PageHeader";
import { zonedParts } from "@/features/booking/time";
import { removeBlock } from "@/features/fleet/actions";
import { BlockForm } from "@/features/fleet/BlockForm";
import { MediaForm } from "@/features/fleet/MediaForm";
import { getVehicle, listBlocks, listClassOptions, listVehicleTrips } from "@/features/fleet/queries";
import { listVehicleMedia } from "@/features/portal/garage";
import { VehicleForm } from "@/features/fleet/VehicleForm";
import { listEntityAudit } from "@/features/leads/queries";
import { can, requirePagePermission } from "@/lib/auth/staff";
import { formatDateTime, formatFullDateTime } from "@/lib/utils/format";

export const metadata: Metadata = { title: "Vehicle" };

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ back?: string }> };

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function VehiclePage({ params, searchParams }: Props) {
  const session = await requirePagePermission("vehicle.view");
  const { id } = await params;
  const { back } = await searchParams;
  if (!uuid.test(id)) notFound();
  const vehicle = await getVehicle(id);
  if (!vehicle) notFound();

  const [t, common, locale, classes, blocks, trips, activity, media] = await Promise.all([
    getTranslations("fleet"),
    getTranslations("common"),
    getLocale(),
    listClassOptions(),
    listBlocks(id),
    listVehicleTrips([id]),
    listEntityAudit("vehicle", id),
    listVehicleMedia([id]),
  ]);
  const editable = can(session, "vehicle.edit");
  const today = zonedParts(new Date(), "America/Los_Angeles").date;

  return (
    <>
      <BackLink href={safeBack(back, "/fleet")} />
      <PageHeader
        eyebrow={locale === "zh" ? (vehicle.vehicle_class?.name_zh ?? vehicle.vehicle_class?.name) : vehicle.vehicle_class?.name}
        title={vehicle.fleet_number}
        actions={vehicle.is_placeholder ? <Badge tone="warning">{t("placeholderTag")}</Badge> : undefined}
      />
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_24rem]">
        <div className="flex flex-col gap-5">
          <section className="card p-6">
            <VehicleForm vehicle={vehicle} classes={classes} editable={editable} />
          </section>
          <section className="card p-6">
            <h2 className="mb-3 text-sm font-semibold">{t("media.title")}</h2>
            <MediaForm vehicleId={id} media={media[id] ?? []} editable={editable} />
          </section>
        </div>
        <div className="flex flex-col gap-5">
          <section className="card p-6">
            <h2 className="text-sm font-semibold">{t("trips")}</h2>
            {(trips[id] ?? []).length === 0 ? (
              <p className="mt-3 text-[13px] text-muted">{common("empty")}</p>
            ) : (
              <ul className="mt-3 flex flex-col gap-2.5">
                {(trips[id] ?? []).map((trip) => (
                  <li key={trip.id}>
                    <Link href={withBack(`/reservations/${trip.id}`, `/fleet/${id}`)} className="block rounded-xl border border-ink/[0.07] px-3.5 py-2.5 text-[13px] hover:border-gold/50">
                      <span className="font-medium">{trip.number}</span>
                      <span className="text-muted"> · {trip.customer?.full_name}</span>
                      <span className="mt-0.5 block text-xs text-muted">
                        {formatDateTime(trip.pickup_at, locale)} → {formatDateTime(trip.return_at, locale)}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section className="card p-6">
            <h2 className="text-sm font-semibold">{t("blocks.title")}</h2>
            {blocks.length > 0 && (
              <ul className="mt-3 flex flex-col gap-2">
                {blocks.map((block) => (
                  <li key={block.id} className="flex items-center justify-between gap-3 rounded-xl bg-status-limited/[0.08] px-3.5 py-2.5 text-[13px]">
                    <span className="min-w-0">
                      <span className="font-medium">{t(`blockType.${block.type}`)}</span>
                      {block.reason ? <span className="text-muted"> · {block.reason}</span> : null}
                      <span className="block text-xs text-muted">
                        {formatDateTime(block.starts_at, locale)} → {formatDateTime(block.ends_at, locale)}
                      </span>
                    </span>
                    {editable && (
                      <form action={removeBlock}>
                        <input type="hidden" name="blockId" value={block.id} />
                        <input type="hidden" name="vehicleId" value={id} />
                        <button type="submit" className="shrink-0 rounded-pill px-2.5 py-1 text-xs text-status-danger hover:bg-status-danger/10">
                          {t("blocks.remove")}
                        </button>
                      </form>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {editable && (
              <div className="mt-4 border-t border-ink/[0.07] pt-4">
                <BlockForm vehicleId={id} today={today} />
              </div>
            )}
          </section>
          <section className="card p-6">
            <h2 className="text-sm font-semibold">{t("activity")}</h2>
            {activity.length === 0 ? (
              <p className="mt-3 text-[13px] text-muted">{common("empty")}</p>
            ) : (
              <ol className="mt-3 flex flex-col gap-2.5">
                {activity.slice(0, 12).map((event) => (
                  <li key={event.id} className="text-[13px]">
                    <p className="font-mono text-[12px] text-charcoal">{event.action}</p>
                    <p className="text-xs text-muted">
                      {formatFullDateTime(event.created_at, locale)}
                      {typeof event.metadata.by === "string" ? ` · ${event.metadata.by}` : ""}
                    </p>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>
      </div>
    </>
  );
}
