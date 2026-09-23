import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/Badge";
import { PageHeader } from "@/components/ops/PageHeader";
import { LedgerStatus, LedgerTabs } from "@/features/finance/ledger/LedgerChrome";
import { LockButton, ReopenForm } from "@/features/finance/ledger/LedgerForms";
import { loadMonths } from "@/features/finance/ledger/views";
import { can, requirePagePermission } from "@/lib/auth/staff";
import { cn } from "@/lib/utils/cn";
import { formatDateTime } from "@/lib/utils/format";

export const metadata: Metadata = { title: "Months" };

export default async function MonthsPage() {
  const session = await requirePagePermission("finance.view");
  const [t, data] = await Promise.all([getTranslations("finance.ledger"), loadMonths()]);
  const closer = can(session, "finance.close");
  const grid = "grid min-w-[44rem] grid-cols-[6rem_6rem_10rem_8rem_minmax(0,1fr)] items-center gap-4 px-5";

  return (
    <>
      <PageHeader title={t("titles.close")} actions={<LedgerStatus />} />
      <LedgerTabs group="close" current="months" />
      <section className="card overflow-x-auto">
        <div className={cn(grid, "border-b border-ink/[0.07] bg-pearl/60 py-2.5 text-[11px] font-medium tracking-[0.12em] text-muted uppercase")}>
          <span>{t("month")}</span>
          <span>{t("months.status")}</span>
          <span>{t("months.lockedAt")}</span>
          <span>{t("months.digest")}</span>
          <span />
        </div>
        <ul className="divide-y divide-ink/[0.06]">
          {data.months.map((month) => {
            const period = data.periods.get(month);
            const state = !period?.locked_at ? "open" : period.reopened_at ? "reopened" : "locked";
            return (
              <li key={month} className={cn(grid, "py-2.5 text-[13px]")}>
                <span className="font-medium tabular-nums">{month}</span>
                <span>
                  <Badge tone={state === "locked" ? "success" : state === "reopened" ? "warning" : "neutral"}>{t(`months.${state}`)}</Badge>
                </span>
                <span className="text-muted tabular-nums">{period?.locked_at ? formatDateTime(period.locked_at) : ""}</span>
                <span className="font-mono text-[11px] text-muted" title={period?.digest ?? undefined}>
                  {period?.digest ? period.digest.slice(0, 12) : ""}
                </span>
                <span className="flex justify-end">
                  {closer && state !== "locked" && month < data.current && <LockButton period={month} />}
                  {closer && state === "locked" && <ReopenForm period={month} />}
                </span>
              </li>
            );
          })}
        </ul>
      </section>
    </>
  );
}
