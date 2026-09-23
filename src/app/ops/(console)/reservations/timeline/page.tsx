import type { Metadata } from "next";
import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Input, Select } from "@/components/ui/Field";
import { PageHeader } from "@/components/ops/PageHeader";
import { currentTime, isIsoDate, zonedParts, zonedToUtc } from "@/features/booking/time";
import { listClassOptions, listVehicles } from "@/features/fleet/queries";
import { listTimeline } from "@/features/reservations/queries";
import type { ReservationStatus } from "@/features/reservations/types";
import { requirePagePermission } from "@/lib/auth/staff";
import { cn } from "@/lib/utils/cn";

export const metadata: Metadata = { title: "Timeline" };

type Props = { searchParams: Promise<{ from?: string; class?: string; q?: string }> };

const zone = "America/Los_Angeles";
const windowDays = 14;

const barTone: Partial<Record<ReservationStatus, string>> = {
  REQUESTED: "bg-gold/25 text-ink border-gold/50",
  PENDING_PAYMENT: "bg-status-limited/25 text-ink border-status-limited/50",
  CONFIRMED: "bg-status-info/20 text-ink border-status-info/45",
  ACTIVE: "bg-status-available/25 text-ink border-status-available/55",
  COMPLETED: "bg-ink/[0.06] text-muted border-ink/10",
};

function shiftDate(date: string, days: number) {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

export default async function TimelinePage({ searchParams }: Props) {
  await requirePagePermission("reservation.view");
  const { from: requested, class: classSlug, q } = await searchParams;
  const t = await getTranslations("reservations");
  const fleet = await getTranslations("fleet");
  const locale = await getLocale();

  const today = zonedParts(new Date(), zone).date;
  const defaultFrom = shiftDate(today, -1);
  const fromDate = isIsoDate(requested) ? requested : defaultFrom;
  const term = (q ?? "").trim().toLowerCase().slice(0, 20);
  const start = zonedToUtc(fromDate, "00:00", zone);
  const end = zonedToUtc(shiftDate(fromDate, windowDays), "00:00", zone);
  const span = end.getTime() - start.getTime();

  const [allVehicles, classes, bars] = await Promise.all([listVehicles(), listClassOptions(), listTimeline(start, end)]);
  const vehicles = allVehicles.filter(
    (vehicle) => (!classSlug || vehicle.vehicle_class?.slug === classSlug) && (!term || vehicle.fleet_number.toLowerCase().includes(term)),
  );
  const days = Array.from({ length: windowDays }, (_, index) => shiftDate(fromDate, index));
  const nowOffset = ((currentTime() - start.getTime()) / span) * 100;

  const link = (date: string) => {
    const params = new URLSearchParams();
    if (date !== defaultFrom) params.set("from", date);
    if (classSlug) params.set("class", classSlug);
    if (term) params.set("q", term);
    const query = params.toString();
    return `/reservations/timeline${query ? `?${query}` : ""}`;
  };

  const dayLabel = (day: string, options: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en-US", { timeZone: "UTC", ...options }).format(new Date(`${day}T12:00:00Z`));

  return (
    <>
      <PageHeader
        title={t("timeline.title")}
        lead={t("timeline.lead")}
        actions={
          <div className="flex gap-2">
            <ButtonLink href={link(shiftDate(fromDate, -7))} size="sm" variant="secondary" aria-label={t("timeline.earlier")}>
              ←
            </ButtonLink>
            <ButtonLink href={link(defaultFrom)} size="sm" variant="secondary">
              {t("timeline.today")}
            </ButtonLink>
            <ButtonLink href={link(shiftDate(fromDate, 7))} size="sm" variant="secondary" aria-label={t("timeline.later")}>
              →
            </ButtonLink>
          </div>
        }
      />
      <form action="/reservations/timeline" className="mb-4 flex flex-wrap items-center gap-2">
        <div className="w-40">
          <Input type="date" name="from" defaultValue={fromDate} aria-label={t("timeline.jump")} className="h-9 text-[13px]" />
        </div>
        <div className="w-44">
        <Select name="class" defaultValue={classSlug ?? ""} aria-label={t("timeline.filterClass")} className="h-9 text-[13px]">
          <option value="">{t("timeline.allClasses")}</option>
          {classes.map((item) => (
            <option key={item.id} value={item.slug}>
              {locale === "zh" ? (item.name_zh ?? item.name) : item.name}
            </option>
          ))}
        </Select>
        </div>
        <div className="w-40">
          <Input type="search" name="q" defaultValue={term} placeholder={t("timeline.search")} aria-label={t("timeline.search")} className="h-9 text-[13px]" />
        </div>
        <Button type="submit" size="sm" variant="secondary">
          {t("timeline.apply")}
        </Button>
        {(classSlug || term) && (
          <Link href={link(fromDate).replace(/([?&])(class|q)=[^&]*/g, "$1").replace(/[?&]$/, "")} className="text-[13px] text-muted hover:text-ink">
            {t("timeline.clear")}
          </Link>
        )}
      </form>
      <div className="card overflow-x-auto">
        <div className="min-w-[56rem]">
          <div className="grid grid-cols-[8.5rem_1fr] border-b border-ink/[0.07] bg-pearl/60">
            <div className="px-4 py-2.5 text-[11px] font-medium tracking-[0.12em] text-muted uppercase">{fleet("fields.fleetNumber")}</div>
            <div className="grid" style={{ gridTemplateColumns: `repeat(${windowDays}, minmax(0, 1fr))` }}>
              {days.map((day) => {
                const weekend = [0, 6].includes(new Date(`${day}T12:00:00Z`).getUTCDay());
                return (
                  <div key={day} className={cn("border-l border-ink/[0.06] px-1 py-2 text-center text-[11px]", day === today ? "font-semibold text-gold" : weekend ? "text-charcoal" : "text-muted")}>
                    {dayLabel(day, { month: "numeric", day: "numeric" })}
                    <span className="block text-[10px] opacity-70">{dayLabel(day, { weekday: "short" })}</span>
                  </div>
                );
              })}
            </div>
          </div>
          {vehicles.length === 0 && <p className="px-5 py-10 text-center text-[13px] text-muted">{t("timeline.noVehicles")}</p>}
          {vehicles.map((vehicle) => (
            <div key={vehicle.id} className="grid grid-cols-[8.5rem_1fr] border-b border-ink/[0.05] last:border-b-0">
              <Link href={`/fleet/${vehicle.id}`} className="px-4 py-3 text-sm hover:bg-gold/[0.04]">
                <span className="font-semibold tracking-wide">{vehicle.fleet_number}</span>
                <span className={cn("block truncate text-[11px]", vehicle.condition === "IN_SERVICE" ? "text-muted" : "text-status-danger")}>
                  {vehicle.condition === "IN_SERVICE" ? (locale === "zh" ? (vehicle.vehicle_class?.name_zh ?? vehicle.vehicle_class?.name) : vehicle.vehicle_class?.name) : fleet(`condition.${vehicle.condition}`)}
                </span>
              </Link>
              <div className="relative h-14">
                <div className="absolute inset-0 grid" style={{ gridTemplateColumns: `repeat(${windowDays}, minmax(0, 1fr))` }} aria-hidden="true">
                  {days.map((day) => (
                    <div key={day} className={cn("border-l border-ink/[0.05]", day === today && "bg-gold/[0.05]")} />
                  ))}
                </div>
                {nowOffset > 0 && nowOffset < 100 && <div aria-hidden="true" className="absolute inset-y-0 z-10 w-px bg-gold" style={{ left: `${nowOffset}%` }} />}
                {bars
                  .filter((bar) => bar.vehicle_id === vehicle.id)
                  .map((bar) => {
                    const left = Math.max(0, ((new Date(bar.start).getTime() - start.getTime()) / span) * 100);
                    const right = Math.min(100, ((new Date(bar.end).getTime() - start.getTime()) / span) * 100);
                    if (right <= left) return null;
                    return (
                      <Link
                        key={`${bar.kind}-${bar.id}`}
                        href={bar.href ?? "#"}
                        title={bar.label}
                        className={cn(
                          "absolute top-2.5 z-20 flex h-9 items-center overflow-hidden rounded-lg border px-2 text-[11px] font-medium whitespace-nowrap hover:brightness-95",
                          bar.kind === "block" ? "border-status-limited/60 bg-[repeating-linear-gradient(135deg,rgba(214,154,45,0.22)_0_6px,rgba(214,154,45,0.08)_6px_12px)] text-charcoal" : barTone[bar.status ?? "CONFIRMED"],
                        )}
                        style={{ left: `${left}%`, width: `${right - left}%` }}
                      >
                        <span className="truncate">{bar.label}</span>
                      </Link>
                    );
                  })}
              </div>
            </div>
          ))}
        </div>
      </div>
      <ul className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-xs text-muted">
        {(["REQUESTED", "CONFIRMED", "ACTIVE", "COMPLETED"] as const).map((status) => (
          <li key={status} className="flex items-center gap-1.5">
            <span className={cn("inline-block size-3 rounded border", barTone[status])} />
            {t(`status.${status}`)}
          </li>
        ))}
        <li className="flex items-center gap-1.5">
          <span className="inline-block size-3 rounded border border-status-limited/60 bg-status-limited/20" />
          {t("timeline.block")}
        </li>
      </ul>
    </>
  );
}
