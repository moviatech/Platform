import type { Metadata } from "next";
import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/Badge";
import { PageHeader } from "@/components/ops/PageHeader";
import { zonedParts } from "@/features/booking/time";
import { FinanceTabs } from "@/features/finance/FinanceTabs";
import { RecurringEnd, RecurringForm } from "@/features/finance/RecurringForms";
import { listLocationPicks, listVehiclePicks } from "@/features/finance/expenses";
import { nextDue } from "@/features/finance/recurring";
import { loadRecurring } from "@/features/finance/recurring-queries";
import { can, requirePagePermission } from "@/lib/auth/staff";
import { cn } from "@/lib/utils/cn";
import { formatMoney } from "@/lib/utils/format";

export const metadata: Metadata = { title: "Recurring expenses" };

export default async function RecurringPage() {
  const session = await requirePagePermission("finance.view");
  const today = zonedParts(new Date(), "America/Los_Angeles").date;
  const [t, tabs, locale, data, vehicles, locations] = await Promise.all([getTranslations("expenses"), getTranslations("finance.tabs"), getLocale(), loadRecurring(today), listVehiclePicks(), listLocationPicks()]);
  const record = can(session, "finance.review");
  const waiting = new Map<string, number>();
  for (const item of data.pending) waiting.set(item.row.id, (waiting.get(item.row.id) ?? 0) + 1);
  const grid = "md:grid-cols-[minmax(0,1.3fr)_7rem_6rem_5rem_6.5rem_minmax(0,1fr)_4rem]";

  return (
    <>
      <PageHeader title={tabs("recurring")} />
      <FinanceTabs current="recurring" />
      {record && (
        <section className="card mb-6 px-5 py-5">
          <RecurringForm today={today} vehicles={vehicles} locations={locations.filter((location) => location.active)} />
        </section>
      )}
      <div className="card overflow-hidden">
        <div className={`hidden gap-4 border-b border-ink/[0.07] bg-pearl/60 px-5 py-2.5 text-[11px] font-medium tracking-[0.12em] text-muted uppercase md:grid ${grid}`}>
          <span>{t("recurringName")}</span>
          <span>{t("category")}</span>
          <span className="text-right">{t("amount")}</span>
          <span>{t("every")}</span>
          <span>{t("nextDue")}</span>
          <span>{t("paidFrom")}</span>
          <span />
        </div>
        {data.templates.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-muted">{t("recurringEmpty")}</p>
        ) : (
          <ul className="divide-y divide-ink/[0.06]">
            {data.templates.map((row) => {
              const next = nextDue(row, today);
              const count = waiting.get(row.id) ?? 0;
              const ended = !next && count === 0;
              const used = data.used.has(row.id);
              return (
                <li key={row.id} className={cn(`grid grid-cols-2 gap-x-4 gap-y-1 px-5 py-3 text-[13px] md:items-center ${grid}`, ended && "opacity-50")}>
                  <span className="min-w-0 truncate">
                    {row.name}
                    {row.vendor && <span className="text-muted"> · {row.vendor}</span>}
                    {count > 0 && (
                      <Link href="/finance/books/expenses" className="ml-2">
                        <Badge tone="warning">{t("dueCount", { count })}</Badge>
                      </Link>
                    )}
                  </span>
                  <span>{t(`categories.${row.category}`)}</span>
                  <span className="font-medium tabular-nums md:text-right">{formatMoney(row.amount_cents)}</span>
                  <span>{t(`everyOptions.${row.every_months}`)}</span>
                  <span className="text-muted">{next ?? (row.ends_on ? t("endedOn", { date: row.ends_on }) : "—")}</span>
                  <span className="min-w-0 truncate text-muted">
                    {t(`paidFromOptions.${row.paid_from}`)}
                    {row.vehicle && ` · ${row.vehicle.fleet_number}`}
                    {row.location && ` · ${locale === "zh" ? (row.location.name_zh ?? row.location.name) : row.location.name}`}
                    {row.spread && ` · ${t("spreadCycle")}`}
                    {row.note && ` · ${row.note}`}
                  </span>
                  <span className="flex md:justify-end">{record && !ended && <RecurringEnd id={row.id} used={used} />}</span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </>
  );
}
