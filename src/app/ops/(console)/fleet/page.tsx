import type { Metadata } from "next";
import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { ButtonLink } from "@/components/ui/Button";
import { PageHeader } from "@/components/ops/PageHeader";
import { listVehicles, listVehicleTrips } from "@/features/fleet/queries";
import type { VehicleCondition } from "@/features/fleet/types";
import { currentTime } from "@/features/booking/time";
import { can, requirePagePermission } from "@/lib/auth/staff";
import { formatDateTime } from "@/lib/utils/format";

export const metadata: Metadata = { title: "Fleet" };

const conditionTone: Record<VehicleCondition, BadgeTone> = {
  IN_SERVICE: "success",
  MAINTENANCE: "warning",
  OUT_OF_SERVICE: "neutral",
  ACCIDENT_HOLD: "danger",
};

export default async function FleetPage() {
  const session = await requirePagePermission("vehicle.view");
  const t = await getTranslations("fleet");
  const locale = await getLocale();
  const vehicles = await listVehicles();
  const trips = await listVehicleTrips(vehicles.map((item) => item.id));
  const now = currentTime();

  const rows = vehicles.map((vehicle) => {
    const upcoming = trips[vehicle.id] ?? [];
    const current = upcoming.find((trip) => trip.status === "ACTIVE" || (new Date(trip.pickup_at).getTime() <= now && new Date(trip.return_at).getTime() >= now && trip.status === "CONFIRMED"));
    const next = upcoming.find((trip) => trip !== current && new Date(trip.pickup_at).getTime() > now);
    return { vehicle, current, next };
  });

  const summary = [
    { label: t("summary.total"), value: vehicles.length },
    { label: t("summary.available"), value: rows.filter((row) => row.vehicle.condition === "IN_SERVICE" && !row.current).length },
    { label: t("summary.rented"), value: rows.filter((row) => row.current?.status === "ACTIVE").length },
    { label: t("summary.attention"), value: rows.filter((row) => row.vehicle.condition === "IN_SERVICE" && row.vehicle.clean_state !== "READY").length },
    { label: t("summary.offline"), value: rows.filter((row) => row.vehicle.condition !== "IN_SERVICE").length },
  ];

  return (
    <>
      <PageHeader
        title={t("title")}
        lead={t("lead")}
        actions={
          can(session, "vehicle.edit") ? (
            <ButtonLink href="/fleet/new" size="sm">
              {t("add")}
            </ButtonLink>
          ) : undefined
        }
      />
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-5">
        {summary.map((item) => (
          <div key={item.label} className="card px-5 py-4">
            <p className="text-xs text-muted">{item.label}</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums">{item.value}</p>
          </div>
        ))}
      </div>
      <div className="card overflow-hidden">
        <div className="hidden grid-cols-[7rem_minmax(0,1.2fr)_8rem_5.5rem_6.5rem_minmax(0,1.3fr)_minmax(0,1.3fr)] gap-4 border-b border-ink/[0.07] bg-pearl/60 px-5 py-2.5 text-[11px] font-medium tracking-[0.12em] text-muted uppercase lg:grid">
          <span>{t("fields.fleetNumber")}</span>
          <span>{t("fields.class")}</span>
          <span>{t("fields.condition")}</span>
          <span>{t("fields.battery")}</span>
          <span>{t("fields.odometer")}</span>
          <span>{t("columns.current")}</span>
          <span>{t("columns.next")}</span>
        </div>
        <ul className="divide-y divide-ink/[0.06]">
          {rows.map(({ vehicle, current, next }) => (
            <li key={vehicle.id}>
              <Link
                href={`/fleet/${vehicle.id}`}
                className="grid grid-cols-2 gap-x-4 gap-y-1.5 px-5 py-3.5 text-sm transition-colors hover:bg-gold/[0.04] lg:grid-cols-[7rem_minmax(0,1.2fr)_8rem_5.5rem_6.5rem_minmax(0,1.3fr)_minmax(0,1.3fr)] lg:items-center"
              >
                <span className="font-semibold tracking-wide">
                  {vehicle.fleet_number}
                  {vehicle.is_placeholder && <span className="ml-1.5 align-middle text-[10px] font-normal text-muted">{t("placeholderTag")}</span>}
                </span>
                <span className="truncate text-charcoal">{locale === "zh" ? (vehicle.vehicle_class?.name_zh ?? vehicle.vehicle_class?.name) : vehicle.vehicle_class?.name}</span>
                <span className="flex items-center gap-1.5">
                  <Badge tone={conditionTone[vehicle.condition]}>{t(`condition.${vehicle.condition}`)}</Badge>
                </span>
                <span className="tabular-nums text-charcoal">{vehicle.battery_level === null ? "—" : `${vehicle.battery_level}%`}</span>
                <span className="tabular-nums text-charcoal">{vehicle.odometer === null ? "—" : `${vehicle.odometer.toLocaleString("en-US")} mi`}</span>
                <span className="col-span-2 truncate text-[13px] text-charcoal lg:col-span-1">
                  {current ? `${current.number} · ${current.customer?.full_name ?? ""} → ${formatDateTime(current.return_at, locale)}` : vehicle.clean_state !== "READY" ? t(`clean.${vehicle.clean_state}`) : "—"}
                </span>
                <span className="col-span-2 truncate text-[13px] text-muted lg:col-span-1">{next ? `${formatDateTime(next.pickup_at, locale)} · ${next.number}` : "—"}</span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}
