import type { Metadata } from "next";
import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/ops/PageHeader";
import { zonedParts } from "@/features/booking/time";
import { FinanceTabs } from "@/features/finance/FinanceTabs";
import { firstPeriodDate, parsePeriod, periodKinds, switchPeriod } from "@/features/finance/sales-tax";
import { loadSalesTax } from "@/features/finance/sales-tax-queries";
import { ratePercent } from "@/features/pricing/quote";
import { can, requirePagePermission } from "@/lib/auth/staff";
import { cn } from "@/lib/utils/cn";
import { formatMoney } from "@/lib/utils/format";
import { CsvLink } from "@/components/ops/CsvLink";

export const metadata: Metadata = { title: "Sales tax" };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function SalesTaxPage({ searchParams }: Props) {
  const session = await requirePagePermission("finance.view");
  const search = await searchParams;
  const today = zonedParts(new Date(), "America/Los_Angeles").date;
  const period = parsePeriod(search.period, today);
  const [t, locale] = await Promise.all([getTranslations("finance.taxTable"), getLocale()]);
  const report = await loadSalesTax(period, locale);
  const grid = "grid min-w-[58rem] grid-cols-[minmax(0,1fr)_5rem_4rem_7rem_7rem_7rem_6rem_6rem_7rem] gap-4 px-5";
  const pill = "rounded-pill px-3.5 py-1.5 text-[13px] hairline hover:border-ink/25";
  const money = (cents: number) => (cents === 0 ? "—" : formatMoney(cents));
  const columns = ["sales", "taxable", "exempt", "tax", "refundTax", "due"] as const;
  const cells = (row: { salesCents: number; taxableCents: number; exemptCents: number; taxCents: number; refundTaxCents: number; dueCents: number }) => [row.salesCents, row.taxableCents, row.exemptCents, row.taxCents, -row.refundTaxCents, row.dueCents];

  return (
    <>
      <PageHeader
        eyebrow={t("basis")}
        title={t("title")}
        actions={
          can(session, "finance.export") ? (
            <CsvLink href={`/finance/export?kind=tax&period=${period.key}`}>
              {t("export")}
            </CsvLink>
          ) : undefined
        }
      />
      <FinanceTabs current="tax" />
      <div className="mb-5 flex flex-wrap items-center gap-2">
        {periodKinds.map((kind) => (
          <Link key={kind} href={`/finance/books/tax?period=${switchPeriod(period, kind, today).key}`} aria-current={kind === period.kind ? "page" : undefined} className={cn(pill, kind === period.kind && "bg-ink text-white")}>
            {t(`kinds.${kind}`)}
          </Link>
        ))}
        <span className="mx-1 h-5 w-px bg-ink/10" />
        {period.from > firstPeriodDate && (
          <Link href={`/finance/books/tax?period=${period.previous}`} className={pill}>
            ← {period.previous}
          </Link>
        )}
        <span className="px-1 text-[15px] font-semibold tabular-nums">{period.key}</span>
        {period.to < today && (
          <Link href={`/finance/books/tax?period=${period.next}`} className={pill}>
            {period.next} →
          </Link>
        )}
      </div>
      <section className="card overflow-x-auto">
        <div className={cn(grid, "border-b border-ink/[0.07] bg-pearl/60 py-2.5 text-[11px] font-medium tracking-[0.12em] text-muted uppercase")}>
          <span>{t("location")}</span>
          <span className="text-right">{t("rate")}</span>
          <span className="text-right">{t("orders")}</span>
          {columns.map((column) => (
            <span key={column} className="text-right">
              {t(column)}
            </span>
          ))}
        </div>
        {report.rows.length === 0 ? (
          <p className="px-5 py-8 text-center text-[13px] text-muted">{t("empty")}</p>
        ) : (
          <ul className="divide-y divide-ink/[0.06]">
            {report.rows.map((row) => (
              <li key={`${row.locationId}:${row.rateBps}`} className={cn(grid, "py-2.5 text-[13px]")}>
                <span className="truncate font-medium">{row.location}</span>
                <span className="text-right tabular-nums">{ratePercent(row.rateBps)}</span>
                <span className="text-right tabular-nums">{row.orders}</span>
                {cells(row).map((cents, index) => (
                  <span key={columns[index]} className={cn("text-right tabular-nums", columns[index] === "due" && "font-medium")}>
                    {money(cents)}
                  </span>
                ))}
              </li>
            ))}
            <li className={cn(grid, "bg-pearl/60 py-2.5 text-[13px] font-semibold")}>
              <span>{t("total")}</span>
              <span />
              <span className="text-right tabular-nums">{report.total.orders}</span>
              {cells(report.total).map((cents, index) => (
                <span key={columns[index]} className="text-right tabular-nums">
                  {money(cents)}
                </span>
              ))}
            </li>
          </ul>
        )}
        {report.cancellationCents !== 0 && (
          <div className="flex justify-between border-t border-ink/[0.07] px-5 py-2.5 text-[13px] text-charcoal">
            <span>
              {t("cancelled")} · {report.cancelled}
            </span>
            <span className="tabular-nums">{formatMoney(report.cancellationCents)}</span>
          </div>
        )}
      </section>
    </>
  );
}
