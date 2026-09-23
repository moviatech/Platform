import type { Metadata } from "next";
import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { PageHeader } from "@/components/ops/PageHeader";
import { createPrepTask, startPrepTask } from "@/features/prep/actions";
import { listPrepBoard } from "@/features/prep/queries";
import { prepItems } from "@/features/prep/template";
import { currentTime } from "@/features/booking/time";
import { can, requirePagePermission } from "@/lib/auth/staff";
import { cn } from "@/lib/utils/cn";
import { formatDateTime } from "@/lib/utils/format";

export const metadata: Metadata = { title: "Prep" };

export default async function PrepPage() {
  const session = await requirePagePermission("prep.view");
  const [t, locale, board] = await Promise.all([getTranslations("prep"), getLocale(), listPrepBoard()]);
  const manage = can(session, "prep.manage");
  const now = currentTime();
  const cleanTone: Record<string, BadgeTone> = { READY: "success", NEEDS_CLEANING: "warning", NEEDS_CHARGING: "warning", NEEDS_BOTH: "danger" };

  return (
    <>
      <PageHeader title={t("title")} />
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
                    {(locale === "zh" ? vehicle.vehicle_class?.name_zh : null) ?? vehicle.vehicle_class?.name ?? "—"}
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
              {manage && !offline && (
                <div className="mt-auto flex gap-2">
                  {vehicle.task ? (
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
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </>
  );
}
