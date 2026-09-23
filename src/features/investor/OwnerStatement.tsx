import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { Logo } from "@/components/ui/Logo";
import { zonedParts } from "@/features/booking/time";
import { Icon } from "@/features/portal/icons";
import type { InvestorSession } from "@/lib/auth/investor";
import { rootDomain } from "@/lib/env";
import { formatDate, formatDateTime, formatMoney } from "@/lib/utils/format";
import { monthLabel } from "./earnings";
import { listEntries } from "./ledger";
import { ownerMonth, rateLabel } from "./owner";
import { vehicleName } from "./OwnerEarnings";
import { PrintButton } from "./PrintButton";
import { monthBounds } from "./stats";

const miles = (value: number) => value.toLocaleString("en-US");

export async function OwnerStatement({ session, month }: { session: InvestorSession; month: string }) {
  const [t, m, ledger, locale] = await Promise.all([getTranslations("investor.statement"), getTranslations("investor.mileage"), getTranslations("investors.ledger"), getLocale()]);
  const { start, end } = monthBounds(month);
  const [data, movements] = await Promise.all([ownerMonth(session.investorId, month), listEntries(session.investorId, { from: start.toISOString(), to: end.toISOString(), limit: 500 })]);
  const other = movements.filter((entry) => entry.type !== "MILEAGE_FEE" && !entry.statement_id);
  const generated = zonedParts(new Date(), "America/Los_Angeles");
  const adjustments = data.statements.flatMap((row) => row.adjustments.map((item) => ({ ...item, vehicle: row.vehicle?.fleet_number ?? "" })));
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
            <p className="mt-1 text-[10px] tracking-[0.24em] text-gold uppercase">Owner Portal</p>
          </div>
          <div className="text-right">
            <h1 className="text-[22px] font-semibold tracking-tight">{t("ownerTitle")}</h1>
            <p className="text-[14px] text-charcoal">{monthLabel(month, locale)}</p>
          </div>
        </div>
        <dl className="mt-6 grid gap-x-8 gap-y-2 text-[13px] sm:grid-cols-2">
          <div className="flex justify-between gap-4">
            <dt className="text-muted">{t("owner")}</dt>
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

        <h2 className="mt-8 mb-3 text-[15px] font-semibold">{t("fees")}</h2>
        {data.statements.length === 0 ? (
          <p className="text-[13px] text-muted">{t("none")}</p>
        ) : (
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="border-b border-ink/[0.1] text-left text-[11px] tracking-[0.1em] text-muted uppercase">
                <th className="py-2 pr-2 font-medium">{m("columns.vehicle")}</th>
                <th className="py-2 pr-2 text-right font-medium">{m("columns.start")}</th>
                <th className="py-2 pr-2 text-right font-medium">{m("columns.end")}</th>
                <th className="py-2 pr-2 text-right font-medium">{m("columns.adjustments")}</th>
                <th className="py-2 pr-2 text-right font-medium">{m("columns.miles")}</th>
                <th className="py-2 pr-2 text-right font-medium">{m("rate")}</th>
                <th className="py-2 pr-2 text-right font-medium">{m("columns.amount")}</th>
                <th className="py-2 font-medium">{m("columns.status")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink/[0.06]">
              {data.statements.map((row) => (
                <tr key={row.id}>
                  <td className="py-2 pr-2">
                    {vehicleName(row, locale)} · {row.vehicle?.fleet_number}
                    {row.final ? ` · ${m("final")}` : ""}
                  </td>
                  <td className="py-2 pr-2 text-right tabular-nums">{row.start_reading === null ? "—" : miles(row.start_reading)}</td>
                  <td className="py-2 pr-2 text-right tabular-nums">{row.end_reading === null ? "—" : miles(row.end_reading)}</td>
                  <td className="py-2 pr-2 text-right tabular-nums">{row.adjustment_miles === 0 ? "—" : `${row.adjustment_miles > 0 ? "+" : ""}${miles(row.adjustment_miles)}`}</td>
                  <td className="py-2 pr-2 text-right tabular-nums">{miles(row.qualifying_miles)}</td>
                  <td className="py-2 pr-2 text-right tabular-nums">{formatMoney(row.rate_cents)}</td>
                  <td className="py-2 pr-2 text-right tabular-nums">{formatMoney(row.amount_cents)}</td>
                  <td className="py-2 whitespace-nowrap">{m(`status.${row.status}`)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-ink/[0.1] font-semibold">
                <td className="py-2 pr-2" colSpan={4}>
                  {t("total")}
                </td>
                <td className="py-2 pr-2 text-right tabular-nums">{miles(data.totals.miles)}</td>
                <td className="py-2 pr-2 text-right tabular-nums">{rateLabel(data.rates, formatMoney)}</td>
                <td className="py-2 pr-2 text-right tabular-nums">{formatMoney(data.totals.amountCents)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        )}

        {adjustments.length > 0 && (
          <>
            <h2 className="mt-8 mb-3 text-[15px] font-semibold">{m("adjustments")}</h2>
            <table className="w-full text-[12.5px]">
              <tbody className="divide-y divide-ink/[0.06]">
                {adjustments.map((item) => (
                  <tr key={item.id}>
                    <td className="py-2 pr-2 whitespace-nowrap text-muted">{formatDateTime(item.created_at)}</td>
                    <td className="py-2 pr-2">{item.vehicle}</td>
                    <td className="py-2 pr-2">{m(`kinds.${item.kind}`)}</td>
                    <td className="py-2 pr-2">{item.reason}</td>
                    <td className="py-2 text-right tabular-nums">{item.miles > 0 ? "+" : ""}{miles(item.miles)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
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
        <p className="mt-8 border-t border-ink/[0.07] pt-4 text-[11px] leading-relaxed text-muted">{t("ownerFooter", { domain: rootDomain })}</p>
      </section>
    </div>
  );
}
