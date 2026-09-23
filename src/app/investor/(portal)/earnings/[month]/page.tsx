import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { zonedParts } from "@/features/booking/time";
import { isMonth, monthEarnings, monthLabel } from "@/features/investor/earnings";
import { listEntries } from "@/features/investor/ledger";
import { PrintButton } from "@/features/investor/PrintButton";
import { monthBounds } from "@/features/investor/stats";
import { Logo } from "@/components/ui/Logo";
import { Icon } from "@/features/portal/icons";
import { requireInvestor } from "@/lib/auth/investor";
import { rootDomain } from "@/lib/env";
import { formatDate, formatDateTime, formatMoney } from "@/lib/utils/format";

export const metadata: Metadata = { title: "Monthly statement" };

type Props = { params: Promise<{ month: string }> };

export default async function StatementPage({ params }: Props) {
  const session = await requireInvestor();
  const { month } = await params;
  if (!isMonth(month)) notFound();
  const [t, ledger, locale] = await Promise.all([getTranslations("investor.statement"), getTranslations("investors.ledger"), getLocale()]);
  const { start, end } = monthBounds(month);
  const [data, movements] = await Promise.all([monthEarnings(session.investorId, month, locale), listEntries(session.investorId, { from: start.toISOString(), to: end.toISOString(), limit: 500 })]);
  const other = movements.filter((entry) => entry.type !== "RENTAL_SHARE" && !(entry.type === "ADJUSTMENT" && (entry.metadata as Record<string, unknown>).source === "refund"));
  const generated = zonedParts(new Date(), "America/Los_Angeles");
  return (
    <div className="mx-auto max-w-4xl">
      <div className="no-print mb-5 flex items-center justify-between gap-3">
        <Link href={`/earnings?month=${month}`} className="flex items-center gap-1 text-[13px] text-muted hover:text-ink">
          <Icon name="chevron" size={14} className="rotate-180" />
          {t("back")}
        </Link>
        <PrintButton label={t("print")} />
      </div>
      <section className="card p-8">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-ink/[0.07] pb-6">
          <div>
            <Logo />
            <p className="mt-1 text-[10px] tracking-[0.24em] text-gold uppercase">Investor Portal</p>
          </div>
          <div className="text-right">
            <h1 className="text-[22px] font-semibold tracking-tight">{t("title")}</h1>
            <p className="text-[14px] text-charcoal">{monthLabel(month, locale)}</p>
          </div>
        </div>
        <dl className="mt-6 grid gap-x-8 gap-y-2 text-[13px] sm:grid-cols-2">
          <div className="flex justify-between gap-4">
            <dt className="text-muted">{t("investor")}</dt>
            <dd className="font-medium">{session.legalName}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-muted">{t("number")}</dt>
            <dd className="font-mono">{session.number}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-muted">{t("period")}</dt>
            <dd>
              {formatDate(start)} – {formatDate(new Date(end.getTime() - 1))}
            </dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-muted">{t("generated")}</dt>
            <dd>
              {generated.date} {generated.time}
            </dd>
          </div>
        </dl>

        <h2 className="mt-8 mb-3 text-[15px] font-semibold">{t("shares")}</h2>
        {data.entries.length === 0 ? (
          <p className="text-[13px] text-muted">{t("none")}</p>
        ) : (
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="border-b border-ink/[0.1] text-left text-[11px] tracking-[0.1em] text-muted uppercase">
                <th className="py-2 pr-2 font-medium">{t("columns.vehicle")}</th>
                <th className="py-2 pr-2 font-medium">{t("columns.order")}</th>
                <th className="py-2 pr-2 font-medium">{t("columns.dates")}</th>
                <th className="py-2 pr-2 text-right font-medium">{t("columns.base")}</th>
                <th className="py-2 pr-2 text-right font-medium">{t("columns.share")}</th>
                <th className="py-2 font-medium">{t("columns.status")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink/[0.06]">
              {data.entries.map((entry) => {
                const base = Number((entry.metadata as Record<string, unknown>).baseCents ?? 0) || 0;
                return (
                  <tr key={entry.id}>
                    <td className="py-2 pr-2">{entry.vehicle?.fleet_number ?? "—"}</td>
                    <td className="py-2 pr-2 font-mono">{entry.reservation?.number ?? (entry.type === "ADJUSTMENT" ? ledger("types.ADJUSTMENT") : ledger("types.REVERSAL"))}</td>
                    <td className="py-2 pr-2 whitespace-nowrap text-muted">{entry.reservation ? `${formatDate(entry.reservation.pickup_at)} – ${formatDate(entry.reservation.return_at)}` : entry.memo ?? ""}</td>
                    <td className="py-2 pr-2 text-right tabular-nums">{entry.type === "RENTAL_SHARE" ? formatMoney(base) : "—"}</td>
                    <td className="py-2 pr-2 text-right tabular-nums">{entry.amount_cents < 0 ? "−" : ""}{formatMoney(Math.abs(entry.amount_cents))}</td>
                    <td className="py-2 whitespace-nowrap">{entry.bucket === "AVAILABLE" ? `${t("settledOn")} ${entry.settled_at ? formatDate(entry.settled_at) : ""}` : entry.settles_at ? `${t("settlesOn")} ${formatDate(entry.settles_at)}` : t("pending")}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t border-ink/[0.1] font-semibold">
                <td className="py-2 pr-2" colSpan={3}>
                  {t("total")}
                </td>
                <td className="py-2 pr-2 text-right tabular-nums">{formatMoney(data.totals.baseCents)}</td>
                <td className="py-2 pr-2 text-right tabular-nums">{formatMoney(data.totals.shareCents)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        )}

        <h2 className="mt-8 mb-3 text-[15px] font-semibold">{t("movements")}</h2>
        {other.length === 0 ? (
          <p className="text-[13px] text-muted">{t("none")}</p>
        ) : (
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="border-b border-ink/[0.1] text-left text-[11px] tracking-[0.1em] text-muted uppercase">
                <th className="py-2 pr-2 font-medium">{ledger("date")}</th>
                <th className="py-2 pr-2 font-medium">{ledger("type")}</th>
                <th className="py-2 pr-2 font-medium">{ledger("memo")}</th>
                <th className="py-2 text-right font-medium">{ledger("amount")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink/[0.06]">
              {other.map((entry) => (
                <tr key={entry.id}>
                  <td className="py-2 pr-2 whitespace-nowrap text-muted">{formatDateTime(entry.created_at)}</td>
                  <td className="py-2 pr-2">
                    {ledger(`types.${entry.type}`)} · {ledger(`buckets.${entry.bucket}`)}
                  </td>
                  <td className="py-2 pr-2">{entry.memo ?? "—"}</td>
                  <td className="py-2 text-right tabular-nums">{entry.amount_cents < 0 ? "−" : ""}{formatMoney(Math.abs(entry.amount_cents))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="mt-8 border-t border-ink/[0.07] pt-4 text-[11px] leading-relaxed text-muted">{t("footer", { domain: rootDomain })}</p>
      </section>
    </div>
  );
}
