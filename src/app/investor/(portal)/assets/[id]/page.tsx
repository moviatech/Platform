import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { zonedParts } from "@/features/booking/time";
import { LiveBadge } from "@/features/investor/AssetCard";
import { BackButton } from "@/features/investor/BackButton";
import { liveStatuses } from "@/features/investor/assets";
import { MonthCalendar } from "@/features/investor/Calendar";
import { getAllocation } from "@/features/investor/contributions";
import { allocationMonth, isMonth, monthLabel } from "@/features/investor/earnings";
import { CancelExitButton, RequestExitForm } from "@/features/investor/ExitForms";
import { getActiveExit } from "@/features/investor/exits";
import { StepUpGate } from "@/features/investor/StepUp";
import { hasStepUp } from "@/lib/auth/step-up";
import { holdFor } from "@/features/investor/holds";
import { MonthPicker } from "@/features/investor/MonthPicker";
import { classImage, listVehicleMedia } from "@/features/portal/garage";
import { Icon } from "@/features/portal/icons";
import { PageIntro, whitePill } from "@/features/portal/ui";
import { requireInvestor } from "@/lib/auth/investor";
import { createAdminClient } from "@/lib/supabase/admin";
import { cn } from "@/lib/utils/cn";
import { formatDate, formatMoney } from "@/lib/utils/format";

export const metadata: Metadata = { title: "Vehicle" };

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ month?: string }> };

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function AssetDetailPage({ params, searchParams }: Props) {
  const session = await requireInvestor();
  const { id } = await params;
  const { month: raw } = await searchParams;
  if (!uuid.test(id)) notFound();
  const allocation = await getAllocation(id);
  if (!allocation || allocation.investor_id !== session.investorId) notFound();
  const today = zonedParts(new Date(), "America/Los_Angeles").date;
  const current = today.slice(0, 7);
  const month = isMonth(raw) && raw <= current ? raw : current;
  const [t, assets, fleet, locale, data, media, live, { data: services }] = await Promise.all([
    getTranslations("investor.asset"),
    getTranslations("investor.assets"),
    getTranslations("fleet"),
    getLocale(),
    allocationMonth(allocation, month),
    listVehicleMedia([allocation.vehicle_id]),
    liveStatuses([allocation.vehicle_id]),
    createAdminClient().from("vehicle_service_logs").select("id, kind, performed_on, notes").eq("vehicle_id", allocation.vehicle_id).order("performed_on", { ascending: false }).limit(8),
  ]);
  const [exit, verified] = await Promise.all([getActiveExit(allocation.id), hasStepUp(session.userId)]);
  const images = (media[allocation.vehicle_id] ?? []).filter((item) => item.kind === "IMAGE");
  const cover = images[0]?.url ?? classImage(allocation.vehicle?.vehicle_class?.slug);
  const className = (locale === "zh" ? (allocation.vehicle?.vehicle_class?.name_zh ?? allocation.vehicle?.vehicle_class?.name) : allocation.vehicle?.vehicle_class?.name) ?? "";
  const status = allocation.status === "ENDED" ? "ENDED" : (live[allocation.vehicle_id] ?? "AVAILABLE");
  const stats = data.stats;
  const roi = allocation.cost_basis_cents > 0 ? ((data.settledTotalCents / allocation.cost_basis_cents) * 100).toFixed(2) : null;
  const averageDaily = stats && stats.rentedDays > 0 ? Math.round(data.baseCents / stats.rentedDays) : 0;
  const weekdays = locale === "zh" ? ["一", "二", "三", "四", "五", "六", "日"] : ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const vehicle = allocation.vehicle;
  const metrics = [
    { icon: "coins" as const, label: t("monthBase"), value: formatMoney(data.baseCents) },
    { icon: "list" as const, label: t("monthShare"), value: formatMoney(data.shareCents) },
    { icon: "calendar" as const, label: t("utilization"), value: stats?.utilization === null || stats?.utilization === undefined ? "—" : `${stats.utilization}%`, sub: stats ? t("days", { rented: stats.rentedDays, available: stats.availableDays }) : undefined },
    { icon: "sparkle" as const, label: t("averageDaily"), value: averageDaily > 0 ? formatMoney(averageDaily) : "—" },
  ];
  return (
    <>
      <BackButton label={t("back")} fallback="/assets" />
      <PageIntro
        eyebrow={`${t("crumb")} / ${vehicle?.fleet_number ?? ""}`}
        title={className}
        subtitle={`${vehicle?.fleet_number ?? ""} · ${assets(`source.${allocation.source}`)}`}
        actions={
          <div className="flex items-center gap-2">
            <MonthPicker month={month} label={monthLabel(month, locale)} base={`/assets/${allocation.id}`} max={current} />
            <Link href={`/documents?asset=${allocation.id}`} className={whitePill}>
              <Icon name="doc" size={15} />
              {t("documents")}
            </Link>
          </div>
        }
      />
      <div className="-mt-3 mb-4">
        <LiveBadge live={status} />
      </div>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
        <section className="card relative min-h-56 overflow-hidden bg-[radial-gradient(120%_90%_at_50%_100%,#ece2cf_0%,#f7f3ec_50%,#fbfaf7_100%)]">
          <Image src={cover} alt="" fill unoptimized priority sizes="40rem" className={cover.startsWith("/portal/") ? "object-contain p-[7%]" : "object-cover"} />
        </section>
        <section className="card p-6">
          <h2 className="mb-4 text-[17px] font-semibold tracking-tight">{t("overview")}</h2>
          <dl className="grid grid-cols-2 gap-y-6">
            <div>
              <dt className="text-[12px] text-muted">{allocation.source === "CAPITAL" ? t("invested") : t("handedOver")}</dt>
              <dd className="text-[1.8rem] leading-tight font-semibold tracking-tight">{allocation.source === "CAPITAL" ? formatMoney(allocation.cost_basis_cents) : assets("oneVehicle")}</dd>
            </div>
            <div className="border-l border-ink/[0.07] pl-6">
              <dt className="text-[12px] text-muted">{t("since")}</dt>
              <dd className="text-[1.8rem] leading-tight font-semibold tracking-tight">{allocation.effective_from}</dd>
            </div>
            <div className="border-t border-ink/[0.07] pt-6">
              <dt className="text-[12px] text-muted">{t("settledTotal")}</dt>
              <dd className="text-[1.8rem] leading-tight font-semibold tracking-tight">{formatMoney(data.settledTotalCents)}</dd>
            </div>
            <div className="border-t border-l border-ink/[0.07] pt-6 pl-6">
              <dt className="text-[12px] text-muted">{t("roi")}</dt>
              <dd className="text-[1.8rem] leading-tight font-semibold tracking-tight">{roi === null ? "—" : `${roi}%`}</dd>
              <dd className="text-[11px] text-muted">{t("roiNote")}</dd>
            </div>
          </dl>
        </section>
      </div>
      <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {metrics.map((metric) => (
          <section key={metric.label} className="card flex items-start gap-4 p-5">
            <Icon name={metric.icon} size={22} className="mt-0.5 shrink-0 text-gold" />
            <div>
              <p className="text-[13px] text-muted">{metric.label}</p>
              <p className="text-[1.6rem] leading-tight font-semibold tracking-tight">
                {metric.value}
                {metric.sub && <span className="ml-2 text-[13px] font-normal text-muted">{metric.sub}</span>}
              </p>
            </div>
          </section>
        ))}
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <section className="card p-6">
          <h2 className="mb-4 text-[17px] font-semibold tracking-tight">{t("calendar", { month: monthLabel(month, locale) })}</h2>
          <MonthCalendar month={month} rented={data.rentedDays} maintenance={data.maintenanceDays} weekdays={weekdays} legend={{ rented: t("legend.rented"), idle: t("legend.idle"), maintenance: t("legend.maintenance") }} activeFrom={allocation.effective_from} activeTo={allocation.effective_to} />
          <dl className="mt-4 grid grid-cols-3 divide-x divide-ink/[0.07] text-center text-[13px]">
            <div>
              <dt className="text-muted">{t("legend.rented")}</dt>
              <dd className="text-[17px] font-semibold">{stats?.rentedDays ?? 0}</dd>
            </div>
            <div>
              <dt className="text-muted">{t("available")}</dt>
              <dd className="text-[17px] font-semibold">{stats?.availableDays ?? 0}</dd>
            </div>
            <div>
              <dt className="text-muted">{t("legend.maintenance")}</dt>
              <dd className="text-[17px] font-semibold">{data.maintenanceDays.size}</dd>
            </div>
          </dl>
        </section>
        <section className="card p-6">
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2 className="text-[17px] font-semibold tracking-tight">{t("orders")}</h2>
            {data.entries.some((entry) => entry.bucket === "PENDING") && (
              <span className="inline-flex h-6 items-center gap-1 rounded-pill bg-gold/12 px-2.5 text-[11px] font-medium text-gold">
                <Icon name="clock" size={12} />
                {t("pendingTag")}
              </span>
            )}
          </div>
          {data.entries.length === 0 ? (
            <p className="text-[13px] text-muted">{t("noOrders")}</p>
          ) : (
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-ink/[0.07] text-left text-[11px] tracking-[0.12em] text-muted uppercase">
                  <th className="py-2 pr-2 font-medium">{t("columns.order")}</th>
                  <th className="py-2 pr-2 font-medium">{t("columns.dates")}</th>
                  <th className="py-2 pr-2 text-right font-medium">{t("columns.base")}</th>
                  <th className="py-2 text-right font-medium">{t("columns.share")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink/[0.06]">
                {data.entries.map((entry) => {
                  const base = Number((entry.metadata as Record<string, unknown>).baseCents ?? 0) || 0;
                  const hold = entry.bucket === "PENDING" ? holdFor(data.holds, entry) : null;
                  return (
                    <tr key={entry.id}>
                      <td className="py-2.5 pr-2 font-mono text-[12px]">{entry.reservation?.number ?? entry.memo ?? "—"}</td>
                      <td className="py-2.5 pr-2 text-muted">
                        {entry.reservation ? `${formatDate(entry.reservation.pickup_at)} – ${formatDate(entry.reservation.return_at)}` : "—"}
                        {hold && <span className="block text-[11px] text-[#a87415]">{t("held")} · {hold.reason}</span>}
                      </td>
                      <td className="py-2.5 pr-2 text-right tabular-nums">{entry.type === "RENTAL_SHARE" ? formatMoney(base) : "—"}</td>
                      <td className={cn("py-2.5 text-right font-medium tabular-nums", entry.amount_cents < 0 && "text-status-danger")}>{entry.amount_cents < 0 ? "−" : ""}{formatMoney(Math.abs(entry.amount_cents))}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t border-ink/[0.07] font-semibold">
                  <td className="py-2.5 pr-2">{t("total")}</td>
                  <td className="py-2.5 pr-2 text-muted">{stats ? t("daysShort", { count: stats.rentedDays }) : ""}</td>
                  <td className="py-2.5 pr-2 text-right tabular-nums">{formatMoney(data.baseCents)}</td>
                  <td className="py-2.5 text-right tabular-nums">{formatMoney(data.shareCents)}</td>
                </tr>
              </tfoot>
            </table>
          )}
        </section>
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <section className="card p-6">
          <h2 className="mb-4 text-[17px] font-semibold tracking-tight">{t("condition")}</h2>
          <dl className="grid grid-cols-2 gap-3 text-[13px]">
            <div className="rounded-xl bg-[#f7f4ee] px-4 py-3">
              <dt className="text-[11px] text-muted">{t("status")}</dt>
              <dd className="font-medium">{vehicle ? fleet(`condition.${vehicle.condition}`) : "—"}</dd>
            </div>
            <div className="rounded-xl bg-[#f7f4ee] px-4 py-3">
              <dt className="text-[11px] text-muted">{t("odometer")}</dt>
              <dd className="font-medium">{vehicle?.odometer !== null && vehicle?.odometer !== undefined ? `${vehicle.odometer.toLocaleString("en-US")} mi` : "—"}</dd>
            </div>
            <div className="rounded-xl bg-[#f7f4ee] px-4 py-3">
              <dt className="text-[11px] text-muted">{t("battery")}</dt>
              <dd className="font-medium">{vehicle?.battery_level !== null && vehicle?.battery_level !== undefined ? `${vehicle.battery_level}%` : "—"}</dd>
            </div>
            <div className="rounded-xl bg-[#f7f4ee] px-4 py-3">
              <dt className="text-[11px] text-muted">{t("year")}</dt>
              <dd className="font-medium">{[vehicle?.year, vehicle?.exterior_color].filter(Boolean).join(" · ") || "—"}</dd>
            </div>
          </dl>
          <h3 className="mt-5 mb-2 text-[13px] font-semibold">{t("service")}</h3>
          {(services ?? []).length === 0 ? (
            <p className="text-[13px] text-muted">{t("noService")}</p>
          ) : (
            <ul className="divide-y divide-ink/[0.06] text-[13px]">
              {(services ?? []).map((log) => (
                <li key={log.id} className="flex items-center justify-between gap-3 py-2">
                  <span>{fleet(`service.kinds.${log.kind}`)}</span>
                  <span className="text-muted">{log.performed_on}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="card p-6">
          <h2 className="mb-4 text-[17px] font-semibold tracking-tight">{t("gallery")}</h2>
          {images.length === 0 ? (
            <p className="text-[13px] text-muted">{t("noGallery")}</p>
          ) : (
            <ul className="grid grid-cols-3 gap-3">
              {images.slice(0, 6).map((image) => (
                <li key={image.id} className="relative aspect-[4/3] overflow-hidden rounded-xl bg-pearl">
                  <Image src={image.url} alt={image.caption ?? ""} fill unoptimized sizes="12rem" className="object-cover" />
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
      {allocation.status !== "ENDED" && (
        <section className="card mt-4 p-6">
          <h2 className="text-[17px] font-semibold tracking-tight">{t("exit.title")}</h2>
          {exit ? (
            <div className="mt-3 flex flex-wrap items-center gap-3 rounded-xl bg-[#f7f4ee] px-4 py-3 text-[13px]">
              <span className="font-medium">{t(`exit.status.${exit.status}`)}</span>
              {exit.reason && <span className="text-muted">· {exit.reason}</span>}
              {exit.resolution_note && exit.resolution_note !== "cancelled_by_investor" && <span className="text-muted">· {exit.resolution_note}</span>}
              {exit.status === "REQUESTED" && <CancelExitButton id={exit.id} />}
            </div>
          ) : (
            <>
              <p className="mt-1 mb-4 max-w-2xl text-[13px] text-muted">{t("exit.body")}</p>
              <StepUpGate verified={verified} email={session.email}>
                <RequestExitForm allocationId={allocation.id} />
              </StepUpGate>
            </>
          )}
        </section>
      )}
    </>
  );
}
