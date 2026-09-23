import type { Metadata } from "next";
import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { PageHeader } from "@/components/ops/PageHeader";
import { createPrepTask, startPrepTask } from "@/features/prep/actions";
import { listPrepBoard, listPrepHistory } from "@/features/prep/queries";
import { listLocationOptions } from "@/features/fleet/queries";
import { QueryFilters } from "@/components/ops/QueryFilters";
import { allowsLocation } from "@/lib/auth/scope";
import { prepItems } from "@/features/prep/template";
import { currentTime } from "@/features/booking/time";
import { can, requirePagePermission } from "@/lib/auth/staff";
import { cn } from "@/lib/utils/cn";
import { formatDateTime } from "@/lib/utils/format";

export const metadata: Metadata = { title: "Prep" };

type Props = { searchParams: Promise<{ q?: string; location?: string; task?: string; view?: string }> };

const historyGrid = "md:grid-cols-[9.5rem_minmax(0,1.3fr)_7rem_6rem_6.5rem_6.5rem_minmax(0,1fr)]";

export default async function PrepPage({ searchParams }: Props) {
  const session = await requirePagePermission("prep.view");
  const filters = await searchParams;
  const history = filters.view === "history";
  const [t, common, locale, locations] = await Promise.all([getTranslations("prep"), getTranslations("common"), getLocale(), listLocationOptions()]);
  const term = (filters.q ?? "").trim().toLowerCase();
  const matches = (vehicle: { fleet_number: string; license_plate: string | null; location_id: string }) => {
    if (term && ![vehicle.fleet_number, vehicle.license_plate].some((value) => value?.toLowerCase().includes(term))) return false;
    if (filters.location && vehicle.location_id !== filters.location) return false;
    return true;
  };
  const locationSelect = { name: "location", label: t("filters.location"), options: locations.filter((item) => allowsLocation(session, item.id)).map((item) => ({ value: item.id, label: locale === "zh" ? (item.name_zh ?? item.name) : item.name })) };
  const className = (vehicle: { vehicle_class: { name: string; name_zh: string | null } | null }) => (locale === "zh" ? vehicle.vehicle_class?.name_zh : null) ?? vehicle.vehicle_class?.name ?? "—";
  const tabs = (
    <nav className="mb-4 flex gap-2">
      {(["board", "history"] as const).map((key) => (
        <Link
          key={key}
          href={key === "history" ? "/prep?view=history" : "/prep"}
          className={cn("shrink-0 rounded-pill px-3.5 py-1.5 text-[13px] transition-colors", (key === "history") === history ? "bg-ink text-white" : "bg-white text-charcoal hairline hover:border-ink/20")}
        >
          {t(`views.${key}`)}
        </Link>
      ))}
    </nav>
  );

  if (history) {
    const rows = await listPrepHistory({ term: filters.q, locationId: filters.location });
    const duration = (row: { started_at: string | null; completed_at: string | null }) => {
      if (!row.started_at || !row.completed_at) return "—";
      const minutes = Math.max(1, Math.round((new Date(row.completed_at).getTime() - new Date(row.started_at).getTime()) / 60000));
      return minutes >= 60 ? t("history.hours", { hours: Math.floor(minutes / 60), minutes: minutes % 60 }) : t("history.minutes", { minutes });
    };
    return (
      <>
        <PageHeader title={t("title")} />
        {tabs}
        <QueryFilters search={{ name: "q", placeholder: t("filters.search") }} selects={[locationSelect]} />
        {rows.length === 0 ? (
          <div className="card px-6 py-14 text-center text-sm text-muted">{common("empty")}</div>
        ) : (
          <div className="card overflow-hidden">
            <div className={`hidden gap-4 border-b border-ink/[0.07] bg-pearl/60 px-5 py-2.5 text-[11px] font-medium tracking-[0.12em] text-muted uppercase md:grid ${historyGrid}`}>
              <span>{t("history.completed")}</span>
              <span>{t("history.vehicle")}</span>
              <span>{t("history.staff")}</span>
              <span>{t("history.duration")}</span>
              <span>{t("history.photos")}</span>
              <span>{t("history.reservation")}</span>
              <span>{t("notes")}</span>
            </div>
            <ul className="divide-y divide-ink/[0.06]">
              {rows.map((row) => (
                <li key={row.id}>
                  <Link href={`/prep/${row.id}`} className={`grid grid-cols-2 gap-x-4 gap-y-1 px-5 py-3.5 text-[13px] hover:bg-pearl/50 md:items-center ${historyGrid}`}>
                    <span className="tabular-nums text-charcoal">{row.completed_at ? formatDateTime(row.completed_at) : "—"}</span>
                    <span className="min-w-0 text-right md:text-left">
                      <span className="block truncate text-sm font-medium">{row.vehicle?.fleet_number ?? "—"}</span>
                      {row.vehicle && (
                        <span className="block truncate text-[12px] text-muted">
                          {className(row.vehicle)}
                          {row.vehicle.license_plate ? ` · ${row.vehicle.license_plate}` : ""}
                        </span>
                      )}
                    </span>
                    <span className="truncate text-charcoal">{row.staff ?? "—"}</span>
                    <span className="text-right tabular-nums text-charcoal md:text-left">{duration(row)}</span>
                    <span className="tabular-nums text-charcoal">{row.photos.before + row.photos.after > 0 ? t("history.photoCount", { before: row.photos.before, after: row.photos.after }) : "—"}</span>
                    <span className="text-right tabular-nums text-charcoal md:text-left">{row.reservation?.number ?? "—"}</span>
                    <span className="col-span-2 flex min-w-0 items-center gap-2 md:col-span-1">
                      {row.issue && <Badge tone={row.issue_open ? "danger" : "neutral"}>{row.issue_open ? t("issueOpen") : t("issueResolved")}</Badge>}
                      <span className="min-w-0 truncate text-muted">{row.notes ?? row.issue ?? ""}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}
      </>
    );
  }

  const board = (await listPrepBoard()).filter((vehicle) => {
    if (!matches(vehicle)) return false;
    if (filters.task === "none" && vehicle.task) return false;
    if (filters.task === "issue" && !vehicle.task?.issue_open) return false;
    if ((filters.task === "OPEN" || filters.task === "IN_PROGRESS") && vehicle.task?.status !== filters.task) return false;
    return true;
  });
  const manage = can(session, "prep.manage");
  const now = currentTime();
  const cleanTone: Record<string, BadgeTone> = { READY: "success", NEEDS_CLEANING: "warning", NEEDS_CHARGING: "warning", NEEDS_BOTH: "danger" };

  return (
    <>
      <PageHeader title={t("title")} />
      {tabs}
      <QueryFilters
        search={{ name: "q", placeholder: t("filters.search") }}
        selects={[locationSelect, { name: "task", label: t("filters.task"), options: [{ value: "OPEN", label: t("status.OPEN") }, { value: "IN_PROGRESS", label: t("status.IN_PROGRESS") }, { value: "issue", label: t("issueOpen") }, { value: "none", label: t("filters.noTask") }] }]}
      />
      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {board.map((vehicle) => {
          const doneCount = vehicle.task ? prepItems.filter((item) => vehicle.task?.checklist[item]?.done).length : 0;
          const urgent = vehicle.task && vehicle.next_pickup_at ? new Date(vehicle.next_pickup_at).getTime() - now < 2 * 3600000 : false;
          const offline = vehicle.condition !== "IN_SERVICE";
          return (
            <li key={vehicle.id} className={cn("card flex flex-col gap-3 p-5", urgent && "border-status-danger/40", offline && "opacity-60")}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-base font-semibold">{vehicle.fleet_number}</p>
                  <p className="truncate text-[12px] text-muted">
                    {className(vehicle)}
                    {vehicle.license_plate ? ` · ${vehicle.license_plate}` : ""}
                  </p>
                </div>
                <Badge tone={offline ? "neutral" : (cleanTone[vehicle.clean_state] ?? "neutral")}>{offline ? t(`condition.${vehicle.condition}`) : t(`clean.${vehicle.clean_state}`)}</Badge>
              </div>
              <dl className="flex flex-col gap-1 text-[13px]">
                <div className="flex justify-between gap-4">
                  <dt className="text-muted">{t("nextPickup")}</dt>
                  <dd className={cn("tabular-nums", urgent && "font-semibold text-status-danger")}>{vehicle.next_pickup_at ? formatDateTime(vehicle.next_pickup_at) : "—"}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-muted">{t("battery")}</dt>
                  <dd className="tabular-nums">{vehicle.battery_level === null ? "—" : `${vehicle.battery_level}%`}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-muted">{t("task")}</dt>
                  <dd>
                    {vehicle.task ? (
                      <Link href={`/prep/${vehicle.task.id}`} className="underline decoration-gold/50 underline-offset-2 hover:decoration-gold">
                        {t(`status.${vehicle.task.status}`)} · {doneCount}/{prepItems.length}
                        {vehicle.task.assignee ? ` · ${vehicle.task.assignee}` : ""}
                      </Link>
                    ) : (
                      "—"
                    )}
                    {vehicle.task?.issue_open && <Badge tone="danger">{t("issueOpen")}</Badge>}
                  </dd>
                </div>
              </dl>
              <div className="mt-auto flex items-center gap-2">
                {manage &&
                  !offline &&
                  (vehicle.task ? (
                    vehicle.task.status === "OPEN" ? (
                      <form action={startPrepTask}>
                        <input type="hidden" name="taskId" value={vehicle.task.id} />
                        <Button type="submit" size="sm">
                          {t("start")}
                        </Button>
                      </form>
                    ) : (
                      <Link href={`/prep/${vehicle.task.id}`} className="inline-flex h-8 items-center rounded-pill bg-ink px-3.5 text-[13px] font-medium text-white">
                        {t("open")}
                      </Link>
                    )
                  ) : (
                    <form action={createPrepTask}>
                      <input type="hidden" name="vehicleId" value={vehicle.id} />
                      <Button type="submit" size="sm" variant="secondary">
                        {t("new")}
                      </Button>
                    </form>
                  ))}
                <Link href={`/prep?view=history&q=${encodeURIComponent(vehicle.fleet_number)}`} className="ml-auto text-[12px] text-muted underline-offset-2 hover:text-ink hover:underline">
                  {t("views.history")}
                </Link>
              </div>
            </li>
          );
        })}
      </ul>
    </>
  );
}
