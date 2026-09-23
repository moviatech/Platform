import type { Metadata } from "next";
import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/ops/PageHeader";
import { nextMonth } from "@/features/finance/ledger/dates";
import { LedgerStatus, LedgerTabs } from "@/features/finance/ledger/LedgerChrome";
import { loadAccounts, loadTrial, pickMonth } from "@/features/finance/ledger/views";
import { requirePagePermission } from "@/lib/auth/staff";
import { cn } from "@/lib/utils/cn";
import { formatMoney } from "@/lib/utils/format";

export const metadata: Metadata = { title: "Trial balance" };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

const previousMonth = (month: string) => {
  const [year, value] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year, value - 2, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
};

export default async function TrialPage({ searchParams }: Props) {
  await requirePagePermission("finance.view");
  const search = await searchParams;
  const all = search.month === "all";
  const month = all ? null : pickMonth(search.month);
  const [t, locale, accounts, data] = await Promise.all([getTranslations("finance.ledger"), getLocale(), loadAccounts(), loadTrial(month)]);
  const nameOf = (code: string) => {
    const row = accounts.get(code);
    return row ? (locale === "zh" ? row.name_zh : row.name_en) : code;
  };
  const debit = data.rows.reduce((sum, row) => sum + row.debit, 0);
  const credit = data.rows.reduce((sum, row) => sum + row.credit, 0);
  const range = data.from && data.to ? `&from=${data.from}&to=${data.to}` : "";
  const pill = "rounded-pill px-3.5 py-1.5 text-[13px] hairline hover:border-ink/25";
  const grid = "grid min-w-[40rem] grid-cols-[minmax(0,1.5fr)_8rem_8rem_8rem] gap-4 px-5";

  return (
    <>
      <PageHeader title={t("titles.reports")} actions={<LedgerStatus />} />
      <LedgerTabs group="reports" current="trial" />
      <nav className="mb-5 flex flex-wrap items-center gap-2">
        {month && (
          <Link href={`/finance/reports/trial?month=${previousMonth(month)}`} className={pill}>
            ←
          </Link>
        )}
        {month && <span className="px-2 text-[14px] font-medium tabular-nums">{month}</span>}
        {month && (
          <Link href={`/finance/reports/trial?month=${nextMonth(month)}`} className={pill}>
            →
          </Link>
        )}
        <Link href={all ? "/finance/reports/trial" : "/finance/reports/trial?month=all"} aria-current={all ? "page" : undefined} className={cn(pill, all && "bg-ink text-white")}>
          {t("allTime")}
        </Link>
      </nav>
      <section className="card overflow-x-auto">
        <div className={cn(grid, "border-b border-ink/[0.07] bg-pearl/60 py-2.5 text-[11px] font-medium tracking-[0.12em] text-muted uppercase")}>
          <span>{t("columns.account")}</span>
          <span className="text-right">{t("columns.debit")}</span>
          <span className="text-right">{t("columns.credit")}</span>
          <span className="text-right">{t("columns.balance")}</span>
        </div>
        {data.rows.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-muted">{t("empty")}</p>
        ) : (
          <ul className="divide-y divide-ink/[0.06]">
            {data.rows.map((row) => (
              <li key={row.account} className={cn(grid, "py-2.5 text-[13px]")}>
                <Link href={`/finance/reports?account=${row.account}${range}`} className="min-w-0 truncate hover:text-gold">
                  <span className="tabular-nums">{row.account}</span>
                  <span className="ml-2">{nameOf(row.account)}</span>
                </Link>
                <span className="text-right tabular-nums">{row.debit ? formatMoney(row.debit) : ""}</span>
                <span className="text-right tabular-nums">{row.credit ? formatMoney(row.credit) : ""}</span>
                <span className="text-right tabular-nums">{formatMoney(row.debit - row.credit)}</span>
              </li>
            ))}
            <li className={cn(grid, "py-2.5 text-[13px] font-semibold")}>
              <span>{t("total")}</span>
              <span className="text-right tabular-nums">{formatMoney(debit)}</span>
              <span className="text-right tabular-nums">{formatMoney(credit)}</span>
              <span className={cn("text-right tabular-nums", debit !== credit && "text-status-danger")}>{formatMoney(debit - credit)}</span>
            </li>
          </ul>
        )}
      </section>
    </>
  );
}
