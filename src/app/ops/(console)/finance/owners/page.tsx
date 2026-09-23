import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Field";
import { PageHeader } from "@/components/ops/PageHeader";
import { zonedParts } from "@/features/booking/time";
import { FinanceTabs } from "@/features/finance/FinanceTabs";
import { loadOwnerYear } from "@/features/finance/owner-queries";
import { isYear } from "@/features/finance/owners";
import { can, requirePagePermission } from "@/lib/auth/staff";
import { cn } from "@/lib/utils/cn";
import { formatMoney } from "@/lib/utils/format";

export const metadata: Metadata = { title: "Owner payments" };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function OwnersPage({ searchParams }: Props) {
  const session = await requirePagePermission("finance.view");
  const search = await searchParams;
  const thisYear = Number(zonedParts(new Date(), "America/Los_Angeles").date.slice(0, 4));
  const year = isYear(search.year) && Number(search.year) <= thisYear ? Number(search.year) : thisYear;
  const [t, i, rows] = await Promise.all([getTranslations("finance.owners"), getTranslations("investors"), loadOwnerYear(year)]);
  const years = Array.from({ length: thisYear - 2025 }, (_, index) => thisYear - index);
  const sum = (pick: (row: (typeof rows)[number]) => number) => rows.reduce((total, row) => total + pick(row), 0);
  const grid = "grid min-w-[46rem] grid-cols-[minmax(0,1.4fr)_7rem_7rem_7rem_7rem_7rem] gap-4 px-5";

  return (
    <>
      <PageHeader
        title={t("title")}
        actions={
          can(session, "finance.export") ? (
            <a href={`/finance/export?kind=owners&year=${year}`} className="inline-flex h-8 items-center rounded-pill px-3.5 text-[13px] font-medium hairline hover:border-ink/25">
              {t("export")}
            </a>
          ) : undefined
        }
      />
      <FinanceTabs current="owners" />
      <form className="mb-5 flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-[12px] text-muted">
          {t("year")}
          <Select name="year" defaultValue={String(year)} className="h-9 w-28">
            {years.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </Select>
        </label>
        <Button type="submit" size="sm" variant="secondary">
          {t("apply")}
        </Button>
      </form>
      <section className="card overflow-x-auto">
        <div className={cn(grid, "border-b border-ink/[0.07] bg-pearl/60 py-2.5 text-[11px] font-medium tracking-[0.12em] text-muted uppercase")}>
          <span>{t("owner")}</span>
          <span>{t("mode")}</span>
          <span className="text-right">{t("earnings")}</span>
          <span className="text-right">{t("capitalReturned")}</span>
          <span className="text-right">{t("paid")}</span>
          <span className="text-right">{t("owed")}</span>
        </div>
        {rows.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-muted">{t("empty")}</p>
        ) : (
          <ul className="divide-y divide-ink/[0.06]">
            {rows.map((row) => (
              <li key={row.id} className={cn(grid, "py-2.5 text-[13px]")}>
                <Link href={`/investors/${row.id}`} className="min-w-0 truncate font-medium hover:text-gold">
                  {row.legal_name}
                  <span className="ml-2 text-[11px] font-normal text-muted">{row.investor_number}</span>
                </Link>
                <span className="text-muted">{i(`compensation.${row.compensation}`)}</span>
                <span className="text-right tabular-nums">{formatMoney(row.earningsCents)}</span>
                <span className="text-right tabular-nums">{row.capitalReturnedCents ? formatMoney(row.capitalReturnedCents) : "—"}</span>
                <span className="text-right tabular-nums">{formatMoney(row.paidCents)}</span>
                <span className="text-right tabular-nums">{formatMoney(row.owedCents)}</span>
              </li>
            ))}
            <li className={cn(grid, "py-2.5 text-[13px] font-semibold")}>
              <span>{t("total")}</span>
              <span />
              <span className="text-right tabular-nums">{formatMoney(sum((row) => row.earningsCents))}</span>
              <span className="text-right tabular-nums">{formatMoney(sum((row) => row.capitalReturnedCents))}</span>
              <span className="text-right tabular-nums">{formatMoney(sum((row) => row.paidCents))}</span>
              <span className="text-right tabular-nums">{formatMoney(sum((row) => row.owedCents))}</span>
            </li>
          </ul>
        )}
      </section>
    </>
  );
}
