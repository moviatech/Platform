import type { Metadata } from "next";
import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Field";
import { PageHeader } from "@/components/ops/PageHeader";
import { zonedParts } from "@/features/booking/time";
import { ExpenseForm, ServiceLink, VoidExpenseForm, type ServicePrefill } from "@/features/finance/ExpenseForms";
import { FinanceTabs } from "@/features/finance/FinanceTabs";
import { ReceiptUpload } from "@/features/finance/ReceiptUpload";
import { DueActions } from "@/features/finance/RecurringForms";
import { listExpenses, listLocationPicks, listVehiclePicks } from "@/features/finance/expenses";
import { loadRecurring } from "@/features/finance/recurring-queries";
import { loadServiceDue, loadServiceLog, type ServiceLogRow } from "@/features/finance/service-queries";
import { aiUsedThisMonth } from "@/features/finance/ai/context";
import { listVendorNames } from "@/features/finance/vendor-queries";
import { AI_MONTHLY_CAP } from "@/features/finance/ai/suggest";
import { aiConfigured } from "@/lib/ai/openai";
import { expenseCategories, isMonth, monthRange } from "@/features/finance/report";
import { can, requirePagePermission } from "@/lib/auth/staff";
import { cn } from "@/lib/utils/cn";
import { formatMoney } from "@/lib/utils/format";
import { CsvLink } from "@/components/ops/CsvLink";

export const metadata: Metadata = { title: "Expenses" };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function ExpensesPage({ searchParams }: Props) {
  const session = await requirePagePermission("finance.view");
  const search = await searchParams;
  const today = zonedParts(new Date(), "America/Los_Angeles").date;
  const month = isMonth(search.month) ? search.month : today.slice(0, 7);
  const record = can(session, "finance.review");
  const serviceParam = typeof search.serviceLog === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(search.serviceLog) ? search.serviceLog.toLowerCase() : null;
  const [t, tf, locale, expenses, vehicles, locations, recurring, serviceDue, linked, aiUsed, vendorNames] = await Promise.all([
    getTranslations("expenses"),
    getTranslations("fleet"),
    getLocale(),
    listExpenses(month),
    listVehiclePicks(),
    listLocationPicks(),
    loadRecurring(today),
    loadServiceDue(),
    record && serviceParam ? loadServiceLog(serviceParam) : null,
    record ? aiUsedThisMonth(today.slice(0, 7)) : 0,
    record ? listVendorNames() : [],
  ]);
  const pending = recurring?.pending ?? [];
  const baseHref = `/finance/books/expenses?month=${month}`;
  const serviceLabel = (log: ServiceLogRow) => `${log.performed_on} · ${log.vehicle?.fleet_number ?? "—"} · ${tf(`service.kinds.${log.kind}`)} · ${formatMoney(log.cost_cents)}`;
  const initial: ServicePrefill | null = linked ? { serviceLogId: linked.id, spentOn: linked.performed_on > today ? today : linked.performed_on, amount: (linked.cost_cents / 100).toFixed(2), vendor: linked.vendor ?? "", vehicleId: linked.vehicle_id, label: serviceLabel(linked) } : null;
  const short = (date: string) => `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}${date.slice(0, 4) === today.slice(0, 4) ? "" : `/${date.slice(2, 4)}`}`;
  const live = expenses.filter((item) => !item.voided_at);
  const total = live.reduce((sum, item) => sum + item.amount_cents, 0);
  const byCategory = expenseCategories.map((category) => [category, live.filter((item) => item.category === category).reduce((sum, item) => sum + item.amount_cents, 0)] as const).filter(([, cents]) => cents > 0);
  const range = monthRange(month);
  const grid = "md:grid-cols-[6.5rem_8rem_minmax(0,1fr)_6rem_6rem_6rem_7rem_8rem]";

  return (
    <>
      <PageHeader
        title={t("title")}
        actions={
          can(session, "finance.export") ? (
            <CsvLink href={`/finance/export?from=${range.from}&to=${range.to}&kind=expenses`}>
              {t("export")}
            </CsvLink>
          ) : undefined
        }
      />
      <FinanceTabs current="expenses" />
      {pending.length > 0 && (
        <section className="card mb-6 overflow-hidden">
          <h2 className="border-b border-ink/[0.07] bg-pearl/60 px-5 py-2.5 text-[11px] font-medium tracking-[0.12em] text-muted uppercase">{t("dueCount", { count: pending.length })}</h2>
          <ul className="divide-y divide-ink/[0.06]">
            {pending.map(({ row, dueOn }) => (
              <li key={`${row.id}:${dueOn}`} data-due={`${row.id}:${dueOn}`} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-5 py-3 text-[13px]">
                <span className="min-w-0">
                  <span className="text-muted">{dueOn}</span> · {row.name}
                  <span className="text-muted">
                    {" "}
                    · {t(`categories.${row.category}`)}
                    {row.paid_from !== "COMPANY_ACCOUNT" && ` · ${t(`paidFromOptions.${row.paid_from}`)}`}
                  </span>
                </span>
                {record ? <DueActions recurringId={row.id} dueOn={dueOn} amountCents={row.amount_cents} today={today} /> : <span className="tabular-nums">{formatMoney(row.amount_cents)}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}
      {serviceDue.length > 0 && (
        <section className="card mb-6 overflow-hidden">
          <h2 className="border-b border-ink/[0.07] bg-pearl/60 px-5 py-2.5 text-[11px] font-medium tracking-[0.12em] text-muted uppercase">{t("serviceDue", { count: serviceDue.length })}</h2>
          <ul className="divide-y divide-ink/[0.06]">
            {serviceDue.map((log) => (
              <li key={log.id} data-service={log.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-5 py-3 text-[13px]">
                <span className="min-w-0">
                  {serviceLabel(log)}
                  {log.vendor && <span className="text-muted"> · {log.vendor}</span>}
                </span>
                {record && (
                  <Link href={`${baseHref}&serviceLog=${log.id}#add`} className="text-[13px] text-gold hover:underline">
                    {t("book")}
                  </Link>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
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
        <section id="add" className="card mb-6 px-5 py-5">
          {initial && <ServiceLink initial={initial} clearHref={baseHref} />}
          <ExpenseForm today={today} vehicles={vehicles} locations={locations.filter((location) => location.active)} serviceLogs={serviceDue.map((log) => ({ id: log.id, label: serviceLabel(log) }))} initial={initial} baseHref={baseHref} ai={{ ready: aiConfigured, used: aiUsed, cap: AI_MONTHLY_CAP }} vendorNames={vendorNames} />
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
                  {item.recurring && <span className="text-muted"> · {item.recurring.name}</span>}
                  {item.service_log && <span className="text-muted"> · {t("serviceTag", { date: short(item.service_log.performed_on) })}</span>}
                  {item.location && <span className="text-muted"> · {locale === "zh" ? (item.location.name_zh ?? item.location.name) : item.location.name}</span>}
                  {item.paid_from !== "COMPANY_ACCOUNT" && <span className="text-muted"> · {t(`paidFromOptions.${item.paid_from}`)}</span>}
                  {item.capital && <span className="text-muted"> · {t("capital")}</span>}
                  {item.service_from && item.service_to && <span className="text-muted"> · {t("spread", { from: short(item.service_from), to: short(item.service_to) })}</span>}
                  {item.reference && <span className="text-muted"> · {item.reference}</span>}
                  {item.note && <span className="text-muted"> · {item.note}</span>}
                  {item.void_reason && <span className="text-status-danger"> · {item.void_reason}</span>}
                  {item.receipts.map((receipt, index) => (
                    <a key={receipt.id} href={`/finance/books/expenses/receipts/${receipt.id}`} target="_blank" rel="noreferrer" className="ml-2 text-gold hover:underline">
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
