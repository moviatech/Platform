import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Field";
import { PageHeader } from "@/components/ops/PageHeader";
import { zonedParts } from "@/features/booking/time";
import { FinanceTabs } from "@/features/finance/FinanceTabs";
import { costCategories, isMonth, revenueGroups, shiftMonth } from "@/features/finance/report";
import { loadBalances, loadMonthReport } from "@/features/finance/report-queries";
import { requirePagePermission } from "@/lib/auth/staff";
import { cn } from "@/lib/utils/cn";
import { formatMoney } from "@/lib/utils/format";

export const metadata: Metadata = { title: "Finance report" };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function FinanceReportPage({ searchParams }: Props) {
  await requirePagePermission("finance.view");
  const search = await searchParams;
  const thisMonth = zonedParts(new Date(), "America/Los_Angeles").date.slice(0, 7);
  const month = isMonth(search.month) ? search.month : shiftMonth(thisMonth, -1);
  const before = shiftMonth(month, -1);
  const [t, e, current, previous, balances] = await Promise.all([getTranslations("finance.report"), getTranslations("expenses"), loadMonthReport(month), loadMonthReport(before), loadBalances()]);
  const row = "grid grid-cols-[minmax(0,1fr)_8rem_8rem] gap-4 px-5";
  const money = (cents: number) => (cents === 0 ? "—" : formatMoney(cents));
  const tiles: Array<[string, string]> = [
    [t("orders"), String(current.orders)],
    [t("collected"), formatMoney(current.collectedCents)],
    [t("outstanding"), formatMoney(current.outstandingCents)],
    [t("prepaid"), formatMoney(balances.prepaidCents)],
    [t("ownerBalance"), formatMoney(balances.ownerPayableCents)],
  ];
  const lines: Array<{ label: string; now: number; then: number; kind?: "sub" | "total" | "result" }> = [
    ...revenueGroups.filter((group) => current.statement.revenue[group] !== 0 || previous.statement.revenue[group] !== 0).map((group) => ({ label: t(`revenue.${group}`), now: current.statement.revenue[group], then: previous.statement.revenue[group], kind: "sub" as const })),
    { label: t("revenueTotal"), now: current.statement.revenueCents, then: previous.statement.revenueCents, kind: "total" },
    { label: t("ownerPay"), now: -current.statement.payableCents, then: -previous.statement.payableCents },
    { label: t("gross"), now: current.statement.grossCents, then: previous.statement.grossCents, kind: "total" },
    ...costCategories.filter((category) => current.statement.costs[category] !== 0 || previous.statement.costs[category] !== 0).map((category) => ({ label: category === "SERVICE" ? t("service") : category === "STRIPE" ? t("stripeFees") : e(`categories.${category}`), now: -current.statement.costs[category], then: -previous.statement.costs[category], kind: "sub" as const })),
    { label: t("costTotal"), now: -current.statement.costCents, then: -previous.statement.costCents, kind: "total" },
    { label: t("profit"), now: current.statement.profitCents, then: previous.statement.profitCents, kind: "result" },
    { label: t("tax"), now: current.statement.taxCents, then: previous.statement.taxCents },
  ];
  const vehicleGrid = "grid min-w-[44rem] grid-cols-[minmax(0,1fr)_4rem_4rem_7rem_7rem_7rem_7rem_5rem] gap-4 px-5";

  return (
    <>
      <PageHeader eyebrow={t("basis")} title={t("title")} />
      <FinanceTabs current="report" />
      <form className="mb-5 flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-[12px] text-muted">
          {t("month")}
          <Input type="month" name="month" defaultValue={month} max={thisMonth} className="h-9" />
        </label>
        <Button type="submit" size="sm" variant="secondary">
          {t("apply")}
        </Button>
        <Link href={`/finance/report?month=${before}`} className="rounded-pill px-3.5 py-1.5 text-[13px] hairline hover:border-ink/25">
          ← {before}
        </Link>
        {month < thisMonth && (
          <Link href={`/finance/report?month=${shiftMonth(month, 1)}`} className="rounded-pill px-3.5 py-1.5 text-[13px] hairline hover:border-ink/25">
            {shiftMonth(month, 1)} →
          </Link>
        )}
      </form>
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-5">
        {tiles.map(([label, value]) => (
          <div key={label} className="card px-5 py-4">
            <p className="text-xs text-muted">{label}</p>
            <p className="mt-1 text-xl font-semibold tabular-nums">{value}</p>
          </div>
        ))}
      </div>
      <section className="card mb-6 overflow-hidden">
        <div className={cn(row, "border-b border-ink/[0.07] bg-pearl/60 py-2.5 text-[11px] font-medium tracking-[0.12em] text-muted uppercase")}>
          <span>{t("item")}</span>
          <span className="text-right">{month}</span>
          <span className="text-right">{before}</span>
        </div>
        <ul className="divide-y divide-ink/[0.06]">
          {lines.map((line) => (
            <li key={line.label} className={cn(row, "py-2.5 text-[13px]", line.kind === "sub" && "text-charcoal", line.kind === "total" && "font-semibold", line.kind === "result" && "bg-pearl/60 text-[15px] font-semibold")}>
              <span className={cn(line.kind === "sub" && "pl-4")}>{line.label}</span>
              <span className={cn("text-right tabular-nums", line.now < 0 && line.kind === "result" && "text-status-danger")}>{money(line.now)}</span>
              <span className="text-right tabular-nums text-muted">{money(line.then)}</span>
            </li>
          ))}
        </ul>
      </section>
      {current.vehicles.length > 0 && (
        <section className="card overflow-x-auto">
          <div className={cn(vehicleGrid, "border-b border-ink/[0.07] bg-pearl/60 py-2.5 text-[11px] font-medium tracking-[0.12em] text-muted uppercase")}>
            <span>{t("vehicle")}</span>
            <span className="text-right">{t("orders")}</span>
            <span className="text-right">{t("days")}</span>
            <span className="text-right">{t("income")}</span>
            <span className="text-right">{t("ownerPay")}</span>
            <span className="text-right">{t("vehicleCost")}</span>
            <span className="text-right">{t("contribution")}</span>
            <span className="text-right">{t("utilization")}</span>
          </div>
          <ul className="divide-y divide-ink/[0.06]">
            {current.vehicles.map((vehicle) => (
              <li key={vehicle.vehicle_id} className={cn(vehicleGrid, "py-2.5 text-[13px]")}>
                <Link href={`/fleet/${vehicle.vehicle_id}`} className="font-medium hover:text-gold">
                  {vehicle.fleet_number}
                </Link>
                <span className="text-right tabular-nums">{vehicle.orders}</span>
                <span className="text-right tabular-nums">{vehicle.days}</span>
                <span className="text-right tabular-nums">{formatMoney(vehicle.revenueCents)}</span>
                <span className="text-right tabular-nums">{money(vehicle.payableCents)}</span>
                <span className="text-right tabular-nums">{money(vehicle.costCents)}</span>
                <span className={cn("text-right font-medium tabular-nums", vehicle.contributionCents < 0 && "text-status-danger")}>{formatMoney(vehicle.contributionCents)}</span>
                <span className="text-right tabular-nums">{vehicle.utilization}%</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
