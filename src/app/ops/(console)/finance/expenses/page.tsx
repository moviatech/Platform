import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Field";
import { PageHeader } from "@/components/ops/PageHeader";
import { zonedParts } from "@/features/booking/time";
import { ExpenseForm, VoidExpenseForm } from "@/features/finance/ExpenseForms";
import { FinanceTabs } from "@/features/finance/FinanceTabs";
import { ReceiptUpload } from "@/features/finance/ReceiptUpload";
import { listExpenses, listVehiclePicks } from "@/features/finance/expenses";
import { expenseCategories, isMonth, monthRange } from "@/features/finance/report";
import { can, requirePagePermission } from "@/lib/auth/staff";
import { cn } from "@/lib/utils/cn";
import { formatMoney } from "@/lib/utils/format";

export const metadata: Metadata = { title: "Expenses" };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function ExpensesPage({ searchParams }: Props) {
  const session = await requirePagePermission("finance.view");
  const search = await searchParams;
  const today = zonedParts(new Date(), "America/Los_Angeles").date;
  const month = isMonth(search.month) ? search.month : today.slice(0, 7);
  const [t, expenses, vehicles] = await Promise.all([getTranslations("expenses"), listExpenses(month), listVehiclePicks()]);
  const live = expenses.filter((item) => !item.voided_at);
  const total = live.reduce((sum, item) => sum + item.amount_cents, 0);
  const byCategory = expenseCategories.map((category) => [category, live.filter((item) => item.category === category).reduce((sum, item) => sum + item.amount_cents, 0)] as const).filter(([, cents]) => cents > 0);
  const record = can(session, "finance.review");
  const range = monthRange(month);
  const grid = "md:grid-cols-[6.5rem_8rem_minmax(0,1fr)_6rem_6rem_6rem_7rem_8rem]";

  return (
    <>
      <PageHeader
        title={t("title")}
        actions={
          can(session, "finance.export") ? (
            <a href={`/finance/export?from=${range.from}&to=${range.to}&kind=expenses`} className="inline-flex h-8 items-center rounded-pill px-3.5 text-[13px] font-medium hairline hover:border-ink/25">
              {t("export")}
            </a>
          ) : undefined
        }
      />
      <FinanceTabs current="expenses" />
      <form className="mb-5 flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-[12px] text-muted">
          {t("month")}
          <Input type="month" name="month" defaultValue={month} max={today.slice(0, 7)} className="h-9" />
        </label>
        <Button type="submit" size="sm" variant="secondary">
          {t("apply")}
        </Button>
      </form>
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="card px-5 py-4">
          <p className="text-xs text-muted">{t("total")}</p>
          <p className="mt-1 text-xl font-semibold tabular-nums">{formatMoney(total)}</p>
        </div>
        {byCategory.map(([category, cents]) => (
          <div key={category} className="card px-5 py-4">
            <p className="text-xs text-muted">{t(`categories.${category}`)}</p>
            <p className="mt-1 text-xl font-semibold tabular-nums">{formatMoney(cents)}</p>
          </div>
        ))}
      </div>
      {record && (
        <section className="card mb-6 px-5 py-5">
          <ExpenseForm today={today} vehicles={vehicles} />
        </section>
      )}
      <div className="card overflow-hidden">
        <div className={`hidden gap-4 border-b border-ink/[0.07] bg-pearl/60 px-5 py-2.5 text-[11px] font-medium tracking-[0.12em] text-muted uppercase md:grid ${grid}`}>
          <span>{t("date")}</span>
          <span>{t("category")}</span>
          <span>{t("vendor")}</span>
          <span>{t("vehicle")}</span>
          <span>{t("method")}</span>
          <span>{t("by")}</span>
          <span className="text-right">{t("amount")}</span>
          <span />
        </div>
        {expenses.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-muted">{t("empty")}</p>
        ) : (
          <ul className="divide-y divide-ink/[0.06]">
            {expenses.map((item) => (
              <li key={item.id} className={cn(`grid grid-cols-2 gap-x-4 gap-y-1 px-5 py-3 text-[13px] md:items-center ${grid}`, item.voided_at && "opacity-50")}>
                <span className="text-muted">{item.spent_on}</span>
                <span>{t(`categories.${item.category}`)}</span>
                <span className="min-w-0 truncate">
                  {item.vendor ?? "—"}
                  {item.reference && <span className="text-muted"> · {item.reference}</span>}
                  {item.note && <span className="text-muted"> · {item.note}</span>}
                  {item.void_reason && <span className="text-status-danger"> · {item.void_reason}</span>}
                  {item.receipts.map((receipt, index) => (
                    <a key={receipt.id} href={`/finance/expenses/receipts/${receipt.id}`} target="_blank" rel="noreferrer" className="ml-2 text-gold hover:underline">
                      {t("receipt")}
                      {index + 1}
                    </a>
                  ))}
                </span>
                {item.vehicle_id ? (
                  <Link href={`/fleet/${item.vehicle_id}`} className="hover:text-gold">
                    {item.vehicle?.fleet_number ?? "—"}
                  </Link>
                ) : (
                  <span>—</span>
                )}
                <span className="text-muted">{t(`methods.${item.method}`)}</span>
                <span className="truncate text-muted">{item.author?.display_name ?? "—"}</span>
                <span className={cn("font-medium tabular-nums md:text-right", item.voided_at && "line-through")}>{formatMoney(item.amount_cents)}</span>
                <span className="flex items-center gap-3 md:justify-end">
                  {item.voided_at ? (
                    <Badge tone="neutral">{t("voided")}</Badge>
                  ) : record ? (
                    <>
                      <ReceiptUpload expenseId={item.id} />
                      <VoidExpenseForm id={item.id} />
                    </>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
