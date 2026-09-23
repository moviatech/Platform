import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { zonedParts } from "@/features/booking/time";
import { isMonth, listEarningMonths, monthEarnings, monthLabel } from "@/features/investor/earnings";
import { MonthPicker } from "@/features/investor/MonthPicker";
import { Icon } from "@/features/portal/icons";
import { goldPill, IconBadge, PageIntro } from "@/features/portal/ui";
import { requireInvestor } from "@/lib/auth/investor";
import { cn } from "@/lib/utils/cn";
import { formatDate, formatMoney } from "@/lib/utils/format";

export const metadata: Metadata = { title: "Earnings" };

type Props = { searchParams: Promise<{ month?: string }> };

export default async function EarningsPage({ searchParams }: Props) {
  const session = await requireInvestor();
  const { month: raw } = await searchParams;
  const today = zonedParts(new Date(), "America/Los_Angeles").date;
  const current = today.slice(0, 7);
  const month = isMonth(raw) && raw <= current ? raw : current;
  const [t, locale] = await Promise.all([getTranslations("investor.earnings"), getLocale()]);
  const [data, months] = await Promise.all([monthEarnings(session.investorId, month, locale), listEarningMonths(session.investorId)]);
  const shares = [...new Set(data.rows.map((row) => row.allocation.revenue_share_bps))];
  const shareLabel = shares.length === 0 ? "—" : shares.length === 1 ? `${shares[0] / 100}%` : `${Math.min(...shares) / 100}–${Math.max(...shares) / 100}%`;
  const status = data.totals.heldCents > 0 ? "HELD" : data.totals.pendingCents > 0 ? "PENDING" : data.totals.shareCents > 0 ? "SETTLED" : "NONE";
  const statusTone: Record<string, string> = { HELD: "bg-status-limited/15 text-[#a87415]", PENDING: "bg-gold/12 text-gold", SETTLED: "bg-status-available/12 text-status-available", NONE: "bg-ink/5 text-charcoal" };
  const composition = data.rows.filter((row) => row.shareCents > 0);
  const compositionTotal = composition.reduce((sum, row) => sum + row.shareCents, 0);
  const rowStatus = (row: (typeof data.rows)[number]) => (row.hold ? { label: t("status.held"), tone: statusTone.HELD, note: row.hold.reason } : row.pendingCents > 0 ? { label: row.nextSettlesAt ? t("status.pendingOn", { date: formatDate(row.nextSettlesAt) }) : t("status.pending"), tone: statusTone.PENDING, note: null } : row.shareCents !== 0 ? { label: t("status.settled"), tone: statusTone.SETTLED, note: null } : { label: "—", tone: statusTone.NONE, note: null });
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
          <IconBadge name="coins" size={10} />
          <div>
            <p className="text-[13px] text-muted">{t("base")}</p>
            <p className="text-[1.8rem] leading-tight font-semibold tracking-tight">{formatMoney(data.totals.baseCents)}</p>
            <p className="text-[12px] text-muted">{t("baseNote")}</p>
          </div>
        </section>
        <section className="card flex items-start gap-4 p-5">
          <IconBadge name="sparkle" size={10} />
          <div>
            <p className="text-[13px] text-muted">{t("shareRate")}</p>
            <p className="text-[1.8rem] leading-tight font-semibold tracking-tight">{shareLabel}</p>
          </div>
        </section>
        <section className="card flex items-start gap-4 p-5">
          <IconBadge name="list" size={10} />
          <div className="min-w-0 flex-1">
            <p className="text-[13px] text-muted">{t("monthShare")}</p>
            <div className="flex flex-wrap items-center gap-3">
              <p className="text-[1.8rem] leading-tight font-semibold tracking-tight">{formatMoney(data.totals.shareCents)}</p>
              <span className={cn("inline-flex h-6 items-center gap-1 rounded-pill px-2.5 text-[11px] font-medium", statusTone[status])}>
                <Icon name="clock" size={12} />
                {t(`status.${status.toLowerCase()}`)}
              </span>
            </div>
          </div>
        </section>
      </div>
      {data.holds.investor && <p className="mt-4 rounded-xl bg-status-limited/10 px-4 py-3 text-[13px] text-[#a87415]">{t("holdNotice", { reason: data.holds.investor.reason })}</p>}
      <section className="card mt-4 p-6">
        <h2 className="mb-4 text-[17px] font-semibold tracking-tight">{t("detail", { month: monthLabel(month, locale) })}</h2>
        {data.rows.length === 0 ? (
          <p className="text-[13px] text-muted">{t("empty")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[40rem] text-[13px]">
              <thead>
                <tr className="border-b border-ink/[0.07] text-left text-[11px] tracking-[0.12em] text-muted uppercase">
                  <th className="py-2 pr-3 font-medium">{t("columns.vehicle")}</th>
                  <th className="py-2 pr-3 text-right font-medium">{t("columns.rental")}</th>
                  <th className="py-2 pr-3 text-right font-medium">{t("columns.discounts")}</th>
                  <th className="py-2 pr-3 text-right font-medium">{t("columns.base")}</th>
                  <th className="py-2 pr-3 text-right font-medium">{t("columns.share")}</th>
                  <th className="py-2 font-medium">{t("columns.status")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink/[0.06]">
                {data.rows.map((row) => {
                  const state = rowStatus(row);
                  return (
                    <tr key={row.allocation.id}>
                      <td className="py-3 pr-3">
                        <Link href={`/assets/${row.allocation.id}`} className="flex items-center gap-3 hover:text-gold">
                          <span className="relative h-10 w-16 shrink-0 overflow-hidden rounded-lg bg-pearl">
                            <Image src={row.cover} alt="" fill unoptimized sizes="4rem" className={row.cover.startsWith("/portal/") ? "object-contain p-1" : "object-cover"} />
                          </span>
                          <span>
                            <span className="block font-medium">{row.className}</span>
                            <span className="block text-[12px] text-muted">{row.allocation.vehicle?.fleet_number}</span>
                          </span>
                        </Link>
                      </td>
                      <td className="py-3 pr-3 text-right tabular-nums">{formatMoney(row.rentalCents)}</td>
                      <td className="py-3 pr-3 text-right tabular-nums text-status-danger">{row.discountCents > 0 ? `−${formatMoney(row.discountCents)}` : "—"}</td>
                      <td className="py-3 pr-3 text-right tabular-nums">{formatMoney(row.baseCents)}</td>
                      <td className="py-3 pr-3 text-right font-semibold tabular-nums">{formatMoney(row.shareCents)}</td>
                      <td className="py-3">
                        <span className={cn("inline-flex h-6 items-center rounded-pill px-2.5 text-[11px] font-medium", state.tone)}>{state.label}</span>
                        {state.note && <span className="mt-1 block max-w-[14rem] text-[11px] text-muted">{state.note}</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="bg-pearl/60 font-semibold">
                  <td className="rounded-l-lg py-3 pr-3 pl-3">{t("total")}</td>
                  <td className="py-3 pr-3 text-right tabular-nums">{formatMoney(data.totals.rentalCents)}</td>
                  <td className="py-3 pr-3 text-right tabular-nums text-status-danger">{data.totals.discountCents > 0 ? `−${formatMoney(data.totals.discountCents)}` : "—"}</td>
                  <td className="py-3 pr-3 text-right tabular-nums">{formatMoney(data.totals.baseCents)}</td>
                  <td className="py-3 pr-3 text-right tabular-nums">{formatMoney(data.totals.shareCents)}</td>
                  <td className="rounded-r-lg py-3" />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
        <div className="mt-5 flex flex-wrap items-center justify-center gap-x-8 gap-y-3 rounded-xl bg-[#f7f4ee] px-5 py-4 text-center">
          <span>
            <span className="block text-[12px] text-muted">{t("base")}</span>
            <span className="text-[17px] font-semibold">{formatMoney(data.totals.baseCents)}</span>
          </span>
          <span className="text-gold">×</span>
          <span>
            <span className="block text-[12px] text-muted">{t("shareRate")}</span>
            <span className="text-[17px] font-semibold">{shareLabel}</span>
          </span>
          <span className="text-gold">=</span>
          <span>
            <span className="block text-[12px] text-muted">{t("yourShare")}</span>
            <span className="text-[17px] font-semibold text-gold">{formatMoney(data.totals.shareCents)}</span>
          </span>
          <span className="ml-auto flex items-center gap-1.5 text-[12px] text-muted">
            <Icon name="help" size={13} />
            {t("exclusions")}
          </span>
        </div>
      </section>
      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
        <section className="card p-6">
          <h2 className="mb-4 text-[17px] font-semibold tracking-tight">{t("composition")}</h2>
          {composition.length === 0 ? (
            <p className="text-[13px] text-muted">{t("empty")}</p>
          ) : (
            <ul className="flex flex-col gap-4">
              {composition.map((row, index) => {
                const percent = compositionTotal > 0 ? Math.round((row.shareCents / compositionTotal) * 100) : 0;
                return (
                  <li key={row.allocation.id} className="flex items-center gap-3">
                    <span className="relative h-10 w-16 shrink-0 overflow-hidden rounded-lg bg-pearl">
                      <Image src={row.cover} alt="" fill unoptimized sizes="4rem" className={row.cover.startsWith("/portal/") ? "object-contain p-1" : "object-cover"} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline justify-between gap-3 text-[13px]">
                        <span className="truncate">{row.className}</span>
                        <span className="font-semibold">{formatMoney(row.shareCents)}</span>
                      </span>
                      <span className="mt-1.5 flex items-center gap-2">
                        <span className="h-2 flex-1 overflow-hidden rounded-pill bg-pearl">
                          <span className={cn("block h-full rounded-pill", index % 2 === 0 ? "bg-gold" : "bg-charcoal")} style={{ width: `${percent}%` }} />
                        </span>
                        <span className="w-9 text-right text-[12px] text-muted">{percent}%</span>
                      </span>
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
        <section className="card p-6">
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
      </div>
    </>
  );
}
