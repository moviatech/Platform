import Image from "next/image";
import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { currentTime } from "@/features/booking/time";
import { classImage, listVehicleMedia } from "@/features/portal/garage";
import { Icon } from "@/features/portal/icons";
import { goldPill, IconBadge, PageIntro } from "@/features/portal/ui";
import { cn } from "@/lib/utils/cn";
import { formatDate, formatMoney } from "@/lib/utils/format";
import { monthLabel } from "./earnings";
import { listStatementMonths, type MileageStatement } from "./mileage";
import { MileageDisputeForm } from "./MileageDisputeForm";
import { MonthPicker } from "./MonthPicker";
import { canDispute, ownerMonth, rateLabel } from "./owner";

export const statementTone: Record<string, string> = { DRAFT: "bg-ink/5 text-charcoal", ISSUED: "bg-gold/12 text-gold", DISPUTED: "bg-status-limited/15 text-[#a87415]", SETTLED: "bg-status-available/12 text-status-available", VOID: "bg-ink/5 text-charcoal", NONE: "bg-ink/5 text-charcoal" };

export const vehicleName = (statement: MileageStatement, locale: string) => (locale === "zh" ? (statement.vehicle?.vehicle_class?.name_zh ?? statement.vehicle?.vehicle_class?.name) : statement.vehicle?.vehicle_class?.name) ?? "";

const miles = (value: number) => value.toLocaleString("en-US");

export async function OwnerEarnings({ investorId, month, current }: { investorId: string; month: string; current: string }) {
  const [t, locale, data, months] = await Promise.all([getTranslations("investor.mileage"), getLocale(), ownerMonth(investorId, month), listStatementMonths(investorId)]);
  const media = await listVehicleMedia([...new Set(data.statements.map((row) => row.vehicle_id))]);
  const now = currentTime();
  const cover = (row: MileageStatement) => (media[row.vehicle_id] ?? []).find((item) => item.kind === "IMAGE")?.url ?? classImage(row.vehicle?.vehicle_class?.slug);
  const overall = data.statements.some((row) => row.status === "DISPUTED") ? "DISPUTED" : data.statements.length > 0 && data.statements.every((row) => row.status === "SETTLED") ? "SETTLED" : data.statements.some((row) => row.status === "ISSUED") ? "ISSUED" : data.statements.length > 0 ? "DRAFT" : "NONE";
  const rate = rateLabel(data.rates, formatMoney);
  return (
    <>
      <PageIntro
        title={t("title")}
        subtitle={t("subtitle")}
        actions={
          <div className="flex items-center gap-2">
            <MonthPicker month={month} label={monthLabel(month, locale)} base="/earnings" max={current} />
            <Link href={`/earnings/${month}`} className={goldPill}>
              {t("report")}
            </Link>
          </div>
        }
      />
      <div className="grid gap-4 sm:grid-cols-3">
        <section className="card flex items-start gap-4 p-5">
          <IconBadge name="compass" size={10} />
          <div>
            <p className="text-[13px] text-muted">{t("miles")}</p>
            <p className="text-[1.8rem] leading-tight font-semibold tracking-tight">{miles(data.totals.miles)}</p>
            <p className="text-[12px] text-muted">{t("milesNote", { gross: miles(data.totals.gross), adjustments: `${data.totals.adjustments > 0 ? "+" : ""}${miles(data.totals.adjustments)}` })}</p>
          </div>
        </section>
        <section className="card flex items-start gap-4 p-5">
          <IconBadge name="sparkle" size={10} />
          <div>
            <p className="text-[13px] text-muted">{t("rate")}</p>
            <p className="text-[1.8rem] leading-tight font-semibold tracking-tight">
              {rate}
              <span className="ml-1 text-[13px] font-normal text-muted">{t("perMile")}</span>
            </p>
          </div>
        </section>
        <section className="card flex items-start gap-4 p-5">
          <IconBadge name="coins" size={10} />
          <div className="min-w-0 flex-1">
            <p className="text-[13px] text-muted">{t("amount")}</p>
            <div className="flex flex-wrap items-center gap-3">
              <p className="text-[1.8rem] leading-tight font-semibold tracking-tight">{formatMoney(data.totals.amountCents)}</p>
              <span className={cn("inline-flex h-6 items-center gap-1 rounded-pill px-2.5 text-[11px] font-medium", statementTone[overall])}>
                <Icon name="clock" size={12} />
                {t(`status.${overall}`)}
              </span>
            </div>
          </div>
        </section>
      </div>
      <section className="card mt-4 p-6">
        <h2 className="mb-4 text-[17px] font-semibold tracking-tight">{t("detail", { month: monthLabel(month, locale) })}</h2>
        {data.statements.length === 0 ? (
          <p className="text-[13px] text-muted">{t("empty")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[44rem] text-[13px]">
              <thead>
                <tr className="border-b border-ink/[0.07] text-left text-[11px] tracking-[0.12em] text-muted uppercase">
                  <th className="py-2 pr-3 font-medium">{t("columns.vehicle")}</th>
                  <th className="py-2 pr-3 text-right font-medium">{t("columns.start")}</th>
                  <th className="py-2 pr-3 text-right font-medium">{t("columns.end")}</th>
                  <th className="py-2 pr-3 text-right font-medium">{t("columns.adjustments")}</th>
                  <th className="py-2 pr-3 text-right font-medium">{t("columns.miles")}</th>
                  <th className="py-2 pr-3 text-right font-medium">{t("columns.amount")}</th>
                  <th className="py-2 font-medium">{t("columns.status")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink/[0.06]">
                {data.statements.map((row) => (
                  <tr key={row.id} className="align-top">
                    <td className="py-3 pr-3">
                      <Link href={`/assets/${row.allocation_id}?month=${month}`} className="flex items-center gap-3 hover:text-gold">
                        <span className="relative h-10 w-16 shrink-0 overflow-hidden rounded-lg bg-pearl">
                          <Image src={cover(row)} alt="" fill unoptimized sizes="4rem" className={cover(row).startsWith("/portal/") ? "object-contain p-1" : "object-cover"} />
                        </span>
                        <span>
                          <span className="block font-medium">{vehicleName(row, locale)}</span>
                          <span className="block text-[12px] text-muted">
                            {row.vehicle?.fleet_number}
                            {row.final ? ` · ${t("final")}` : ""}
                          </span>
                        </span>
                      </Link>
                    </td>
                    <td className="py-3 pr-3 text-right tabular-nums">{row.start_reading === null ? "—" : miles(row.start_reading)}</td>
                    <td className="py-3 pr-3 text-right tabular-nums">{row.end_reading === null ? "—" : miles(row.end_reading)}</td>
                    <td className={cn("py-3 pr-3 text-right tabular-nums", row.adjustment_miles < 0 && "text-status-danger")}>{row.adjustment_miles === 0 ? "—" : `${row.adjustment_miles > 0 ? "+" : ""}${miles(row.adjustment_miles)}`}</td>
                    <td className="py-3 pr-3 text-right tabular-nums">{miles(row.qualifying_miles)}</td>
                    <td className="py-3 pr-3 text-right font-semibold tabular-nums">{formatMoney(row.amount_cents)}</td>
                    <td className="py-3">
                      <span className={cn("inline-flex h-6 items-center rounded-pill px-2.5 text-[11px] font-medium", statementTone[row.status])}>{t(`status.${row.status}`)}</span>
                      {row.status === "DISPUTED" && <span className="mt-1 block max-w-[14rem] text-[11px] text-muted">{t("disputePending", { miles: miles(row.disputed_miles) })}</span>}
                      {row.resolution_note && <span className="mt-1 block max-w-[14rem] text-[11px] text-muted">{row.resolution_note}</span>}
                      {canDispute(row, now) && (
                        <div className="mt-1">
                          <span className="block text-[11px] text-muted">{t("disputeUntil", { date: formatDate(row.dispute_until as string) })}</span>
                          <MileageDisputeForm id={row.id} maxMiles={row.qualifying_miles} />
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-pearl/60 font-semibold">
                  <td className="rounded-l-lg py-3 pr-3 pl-3">{t("total")}</td>
                  <td className="py-3 pr-3" />
                  <td className="py-3 pr-3" />
                  <td className={cn("py-3 pr-3 text-right tabular-nums", data.totals.adjustments < 0 && "text-status-danger")}>{data.totals.adjustments === 0 ? "—" : `${data.totals.adjustments > 0 ? "+" : ""}${miles(data.totals.adjustments)}`}</td>
                  <td className="py-3 pr-3 text-right tabular-nums">{miles(data.totals.miles)}</td>
                  <td className="py-3 pr-3 text-right tabular-nums">{formatMoney(data.totals.amountCents)}</td>
                  <td className="rounded-r-lg py-3" />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
        <div className="mt-5 flex flex-wrap items-center justify-center gap-x-8 gap-y-3 rounded-xl bg-[#f7f4ee] px-5 py-4 text-center">
          <span>
            <span className="block text-[12px] text-muted">{t("miles")}</span>
            <span className="text-[17px] font-semibold">{miles(data.totals.miles)}</span>
          </span>
          <span className="text-gold">×</span>
          <span>
            <span className="block text-[12px] text-muted">{t("rate")}</span>
            <span className="text-[17px] font-semibold">{rate}</span>
          </span>
          <span className="text-gold">=</span>
          <span>
            <span className="block text-[12px] text-muted">{t("amount")}</span>
            <span className="text-[17px] font-semibold text-gold">{formatMoney(data.totals.amountCents)}</span>
          </span>
          <span className="ml-auto flex items-center gap-1.5 text-[12px] text-muted">
            <Icon name="help" size={13} />
            {t("exclusions")}
          </span>
        </div>
      </section>
      <section className="card mt-4 p-6">
        <h2 className="mb-4 text-[17px] font-semibold tracking-tight">{t("history")}</h2>
        {months.length === 0 ? (
          <p className="text-[13px] text-muted">{t("empty")}</p>
        ) : (
          <ul className="divide-y divide-ink/[0.06] text-[13px]">
            {months.slice(0, 12).map((item) => (
              <li key={item} className="flex items-center justify-between gap-3 py-2.5">
                <Link href={`/earnings?month=${item}`} className="font-medium hover:text-gold">
                  {monthLabel(item, locale)}
                </Link>
                <Link href={`/earnings/${item}`} className="flex items-center gap-1 text-gold hover:text-gold-light">
                  <Icon name="doc" size={14} />
                  {t("view")}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
