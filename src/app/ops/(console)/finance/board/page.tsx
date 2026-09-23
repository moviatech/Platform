import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { getLocale, getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Field";
import { PageHeader } from "@/components/ops/PageHeader";
import { breakdown, cashView, channelRows, classRows, moneyChange, period, rateChange, storeRows, type Breakdown, type Change, type VehicleRow } from "@/features/finance/board/metrics";
import { loadBoard } from "@/features/finance/board/queries";
import { PRESETS, boardRange, type BoardRange } from "@/features/finance/board/range";
import { LedgerStatus, LedgerTabs } from "@/features/finance/ledger/LedgerChrome";
import { laDate } from "@/features/finance/ledger/dates";
import { requirePagePermission } from "@/lib/auth/staff";
import { cn } from "@/lib/utils/cn";
import { formatMoney } from "@/lib/utils/format";

export const metadata: Metadata = { title: "Dashboard" };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

const text = (value: string | string[] | undefined) => (typeof value === "string" ? value.trim() : "");
const short = (date: string) => `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`;
const span = (from: string, to: string) => (from.slice(0, 4) === to.slice(0, 4) ? `${short(from)} – ${short(to)}` : `${from} – ${to}`);
const percent = (value: number | null) => (value === null ? "—" : `${Math.round(value * 100)}%`);
const pill = "rounded-pill px-3.5 py-1.5 text-[13px] hairline hover:border-ink/25";

function vouchers(range: BoardRange, extra: Record<string, string>) {
  const query = new URLSearchParams({ basis: "economic", from: range.from, to: range.end, ...extra });
  return `/finance/reports?${query.toString()}`;
}

function Card({ label, value, children, details }: { label: string; value: ReactNode; children?: ReactNode; details?: ReactNode }) {
  const head = (
    <>
      <span className="text-[12px] text-muted">{label}</span>
      <span className="mt-1 block text-[22px] font-semibold tabular-nums">{value}</span>
      {children && <span className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[12px] text-muted">{children}</span>}
    </>
  );
  if (!details) return <div className="card p-4">{head}</div>;
  return (
    <details className="card group p-4">
      <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden">{head}</summary>
      <div className="mt-3 border-t border-ink/[0.07] pt-3 text-[12px]">{details}</div>
    </details>
  );
}

type Line = { key: string; label: ReactNode; cents: number; href?: string; strong?: boolean };

const lines = (rows: Line[]) => (rows.length > 0 ? <Lines rows={rows} /> : undefined);

function Lines({ rows }: { rows: Line[] }) {
  return (
    <ul className="space-y-1">
      {rows.map((row) => (
        <li key={row.key} className={cn("flex items-baseline justify-between gap-3", row.strong && "font-semibold")}>
          {row.href ? (
            <Link href={row.href} className="min-w-0 truncate hover:text-gold">
              {row.label}
            </Link>
          ) : (
            <span className="min-w-0 truncate">{row.label}</span>
          )}
          <span className="tabular-nums">{formatMoney(row.cents)}</span>
        </li>
      ))}
    </ul>
  );
}

export default async function BoardPage({ searchParams }: Props) {
  await requirePagePermission("finance.view");
  const search = await searchParams;
  const now = new Date();
  const today = laDate(now);
  const range = boardRange({ preset: text(search.range), from: text(search.from), to: text(search.to) }, today);
  const [t, locale, data] = await Promise.all([getTranslations("finance.board"), getLocale(), loadBoard(range, now)]);
  const current = period(data.current, data.fleet.vehicles);
  const previous = period(data.previous, data.previousFleet.vehicles);
  const cash = cashView(data.cash, range.end);
  const live = range.end === today;
  const name = (row: { name_zh: string; name_en: string }) => (locale === "zh" ? row.name_zh : row.name_en);
  const accountLines = (rows: Breakdown) => rows.map((row) => ({ key: row.account, label: `${row.account} ${name(row)}`, cents: row.cents, href: vouchers(range, { account: row.account }) }));
  const fleetIds = new Set(data.fleet.vehicles.map((vehicle) => vehicle.id));
  const companyRows = data.current.filter((row) => !row.group_key || !fleetIds.has(row.group_key));
  const versus = (currentCents: number, previousCents: number) => {
    if (!range.partial) return change(moneyChange(currentCents, previousCents));
    return previousCents !== 0 ? <span>{t("prior", { value: formatMoney(previousCents) })}</span> : null;
  };
  const change = (value: Change) => {
    if (!value) return null;
    const sign = value.value > 0 ? "+" : value.value < 0 ? "−" : "";
    const amount = value.kind === "pct" ? `${sign}${Math.round(Math.abs(value.value) * 100)}%` : t("points", { value: `${sign}${(Math.abs(value.value) * 100).toFixed(1)}` });
    return <span>{t("vsPrior", { value: amount })}</span>;
  };
  const vehicleLabel = (row: VehicleRow) => row.vehicle.fleetNumber ?? row.vehicle.plate ?? row.vehicle.id.slice(0, 8);
  const own = current.rows.filter((row) => !row.vehicle.ownerCar);
  const owned = current.rows.filter((row) => row.vehicle.ownerCar);
  const channels = channelRows(data.channels, data.fleet.channels);
  const classes = classRows(current.rows);
  const storeNames = new Map(data.locations.map((location) => [location.id, locale === "zh" ? (location.name_zh ?? location.name) : location.name]));
  const stores = storeRows(data.stores, data.locations.map((location) => location.id));
  const grid = "grid min-w-[46rem] grid-cols-[minmax(0,1.4fr)_repeat(6,6.5rem)] gap-3 px-5";
  const head = "border-b border-ink/[0.07] bg-pearl/60 py-2.5 text-[11px] font-medium tracking-[0.12em] text-muted uppercase";

  const vehicleRow = (row: VehicleRow) => (
    <li key={row.vehicle.id} className={cn(grid, "py-2.5 text-[13px]")}>
      <span className="flex min-w-0 items-center gap-2">
        <Link href={vouchers(range, { vehicle: row.vehicle.id })} className="truncate hover:text-gold">
          {vehicleLabel(row)}
        </Link>
        {!row.vehicle.inServiceOn && (
          <Link href="/finance/board/setup">
            <Badge tone="warning">{t("unregistered")}</Badge>
          </Link>
        )}
      </span>
      <span className="text-right tabular-nums">{formatMoney(row.revenue)}</span>
      <span className="text-right tabular-nums">{formatMoney(row.ownerShare)}</span>
      <span className="text-right tabular-nums">{formatMoney(row.costs)}</span>
      <span className="text-right tabular-nums">{formatMoney(row.depreciation)}</span>
      <span className="text-right tabular-nums">
        {formatMoney(row.contribution)}
        {row.revenue > 0 && <span className="ml-1 text-[11px] text-muted">{percent(row.contribution / row.revenue)}</span>}
      </span>
      <span className="text-right tabular-nums">{percent(row.occupancy)}</span>
    </li>
  );

  const section = (label: string, rows: VehicleRow[]) =>
    rows.length > 0 && (
      <>
        <li className="bg-pearl/40 px-5 py-1.5 text-[11px] font-medium tracking-[0.12em] text-muted uppercase">{label}</li>
        {rows.map(vehicleRow)}
      </>
    );

  const total = (label: string, cents: number, strong = false) => (
    <li className={cn(grid, "py-2 text-[13px]", strong && "font-semibold")}>
      <span className="col-span-6">{label}</span>
      <span className="text-right tabular-nums">{formatMoney(cents)}</span>
    </li>
  );

  return (
    <>
      <PageHeader title={t("title")} actions={<LedgerStatus />} />
      <LedgerTabs group="board" current="board" />
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <nav className="flex flex-wrap items-center gap-2">
          {PRESETS.filter((preset) => preset !== "custom").map((preset) => (
            <Link key={preset} href={preset === "month" ? "/finance/board" : `/finance/board?range=${preset}`} aria-current={range.preset === preset ? "page" : undefined} className={cn(pill, range.preset === preset && "bg-ink text-white")}>
              {t(`ranges.${preset}`)}
            </Link>
          ))}
        </nav>
        <form className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="range" value="custom" />
          <span className="w-40">
            <Input type="month" name="from" defaultValue={range.preset === "custom" ? range.from.slice(0, 7) : ""} required aria-label={t("ranges.from")} className="h-9" />
          </span>
          <span className="w-40">
            <Input type="month" name="to" defaultValue={range.preset === "custom" ? range.to.slice(0, 7) : ""} required aria-label={t("ranges.to")} className="h-9" />
          </span>
          <Button type="submit" size="sm" variant={range.preset === "custom" ? "primary" : "secondary"}>
            {t("ranges.custom")}
          </Button>
        </form>
      </div>
      <p className="mb-4 text-[12px] text-muted tabular-nums">
        {span(range.from, range.end)} · {t("compare", { range: span(range.prevFrom, range.prevTo) })}
      </p>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Card label={t("metrics.revenue")} value={formatMoney(current.all.revenue)} details={lines(accountLines(breakdown(data.current.filter((row) => row.account !== "4080"), ["REVENUE", "CONTRA_REVENUE"], 1)))}>
          {versus(current.all.revenue, previous.all.revenue)}
        </Card>
        <Card
          label={t("metrics.contribution")}
          value={formatMoney(current.contribution)}
          details={
            <Lines
              rows={[
                { key: "revenue", label: t("parts.fleetRevenue"), cents: current.fleetRevenue },
                { key: "owner", label: t("parts.ownerShare"), cents: 0 - current.rows.reduce((sum, row) => sum + row.ownerShare, 0) },
                { key: "costs", label: t("parts.costs"), cents: 0 - current.rows.reduce((sum, row) => sum + row.costs, 0) },
                { key: "depreciation", label: t("parts.depreciation"), cents: 0 - current.depreciation },
                { key: "total", label: t("parts.contribution"), cents: current.contribution, strong: true },
              ]}
            />
          }
        >
          {current.contributionRatio !== null && <span>{t("sub.ratio", { value: percent(current.contributionRatio) })}</span>}
          {versus(current.contribution, previous.contribution)}
        </Card>
        <Card
          label={t("metrics.operating")}
          value={formatMoney(current.operatingProfit)}
          details={
            <Lines
              rows={[
                { key: "contribution", label: t("parts.contribution"), cents: current.contribution },
                { key: "unassigned", label: t("parts.unassigned"), cents: current.unassignedRevenue },
                ...accountLines(breakdown(companyRows, ["COST", "EXPENSE"], 1)),
                ...(companyRows.some((row) => row.account === "4080") ? accountLines(breakdown(companyRows.filter((row) => row.account === "4080"), ["REVENUE"], 1)) : []),
                { key: "total", label: t("parts.operating"), cents: current.operatingProfit, strong: true },
              ]}
            />
          }
        >
          {versus(current.operatingProfit, previous.operatingProfit)}
        </Card>
        <Card
          label={t("metrics.cash")}
          value={formatMoney(cash.total)}
          details={
            <Lines
              rows={[
                { key: "stripe", label: t("cash.stripe"), cents: cash.stripe, href: vouchers({ ...range, from: "2000-01-01" }, { account: "1050" }) },
                { key: "transit", label: t("cash.transit"), cents: cash.transit, href: vouchers({ ...range, from: "2000-01-01" }, { account: "1060" }) },
                { key: "bank", label: cash.bank === null ? `${t("cash.bank")} · ${t("cash.missing")}` : `${t("cash.bank")} · ${t("cash.manual")} · ${short(cash.bankAsOf ?? range.end)}`, cents: cash.bank ?? 0, href: "/finance/board/setup" },
              ]}
            />
          }
        >
          {cash.runwayMonths !== null && <span>{t("sub.runway", { months: cash.runwayMonths.toFixed(1) })}</span>}
          {cash.bank === null ? <span>{t("cash.noBank")}</span> : <span>{t("cash.manual")}</span>}
        </Card>

        <Card label={t("metrics.occupancy")} value={percent(current.occupancy)}>
          <span>{t("sub.days", { rented: current.rentedDays, available: current.availableDays })}</span>
          {range.daysEnd && range.daysEnd < range.end && <span>{t("sub.daysThrough", { date: short(range.daysEnd) })}</span>}
          {change(rateChange(current.occupancy, previous.occupancy))}
        </Card>
        <Card label={t("metrics.adr")} value={current.adr === null ? "—" : formatMoney(Math.round(current.adr))}>
          {change(current.adr !== null && previous.adr !== null ? moneyChange(current.adr, previous.adr) : null)}
        </Card>
        <Card label={t("metrics.perCar")} value={current.revenuePerCarMonth === null ? "—" : formatMoney(Math.round(current.revenuePerCarMonth))}>
          {current.fixedPerCarMonth === null ? (
            <Link href="/finance/board/setup" className="hover:text-gold">
              {t("sub.noFixed")}
            </Link>
          ) : (
            <span>{t("sub.fixed", { value: formatMoney(Math.round(current.fixedPerCarMonth)) })}</span>
          )}
          {current.breakEvenDays !== null && <span>{t("sub.breakEven", { days: current.breakEvenDays.toFixed(1) })}</span>}
          {change(current.revenuePerCarMonth !== null && previous.revenuePerCarMonth !== null ? moneyChange(current.revenuePerCarMonth, previous.revenuePerCarMonth) : null)}
        </Card>
        <Card label={t("metrics.discountRate")} value={percent(current.discountRate)} details={lines(accountLines(breakdown(data.current, ["CONTRA_REVENUE"], -1)))}>
          {change(rateChange(current.discountRate, previous.discountRate))}
        </Card>

        <Card label={t("metrics.receivable")} value={formatMoney(cash.receivable)}>
          {cash.receivableOrders > 0 && <span>{t("sub.orders", { count: cash.receivableOrders })}</span>}
          {cash.overdueDays > 0 && <span className="text-status-danger">{t("sub.overdue", { days: cash.overdueDays })}</span>}
          {cash.credits > 0 && <span>{t("sub.credits", { value: formatMoney(cash.credits) })}</span>}
        </Card>
        <Card label={t("metrics.prepaid")} value={formatMoney(cash.prepaid)} />
        <Card label={t("metrics.owners")} value={formatMoney(cash.ownersPayable)}>
          {live && cash.ownersNextDue && <span>{t("sub.nextDue", { date: short(cash.ownersNextDue) })}</span>}
          {live && cash.pendingWithdrawals > 0 && <span>{t("sub.withdrawals", { value: formatMoney(cash.pendingWithdrawals) })}</span>}
        </Card>
        <Card label={t("metrics.holds")} value={live ? formatMoney(cash.holds) : "—"}>
          {live && cash.holdCount > 0 && <span>{t("sub.holdCount", { count: cash.holdCount })}</span>}
        </Card>
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,3fr)_minmax(0,1fr)]">
        <div className="card p-4">
          <span className="text-[12px] text-muted">{t("metrics.forward")}</span>
          <div className="mt-2 grid grid-cols-3 gap-3">
            {data.fleet.forward.map((window) => (
              <div key={window.days}>
                <span className="block text-[12px] text-muted">{t("sub.window", { days: window.days })}</span>
                <span className="block text-[18px] font-semibold tabular-nums">{formatMoney(window.revenueCents)}</span>
                <span className="block text-[12px] text-muted tabular-nums">{t("sub.bookedDays", { days: window.bookedDays })}</span>
              </div>
            ))}
          </div>
        </div>
        <Link href="/finance/close" className="card block p-4 hover:border-ink/25">
          <span className="text-[12px] text-muted">{t("metrics.pending")}</span>
          <span className={cn("mt-1 block text-[22px] font-semibold tabular-nums", cash.pending > 0 && "text-status-danger")}>{cash.pending}</span>
        </Link>
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        <section className="card overflow-x-auto">
          <div className={cn("grid min-w-[26rem] grid-cols-[minmax(0,1fr)_7rem_4.5rem_4.5rem] gap-3 px-5", head)}>
            <span>{t("tables.channel")}</span>
            <span className="text-right">{t("tables.revenue")}</span>
            <span className="text-right">{t("tables.orders")}</span>
            <span className="text-right">{t("tables.days")}</span>
          </div>
          <ul className="divide-y divide-ink/[0.06]">
            {channels.map((row) => (
              <li key={row.source ?? "other"} className="grid min-w-[26rem] grid-cols-[minmax(0,1fr)_7rem_4.5rem_4.5rem] gap-3 px-5 py-2.5 text-[13px]">
                <span>{row.source ? t(`channels.${row.source}`) : t("tables.other")}</span>
                <span className="text-right tabular-nums">{formatMoney(row.revenue)}</span>
                <span className="text-right tabular-nums">{row.orders}</span>
                <span className="text-right tabular-nums">{row.days}</span>
              </li>
            ))}
          </ul>
        </section>
        <section className="card overflow-x-auto">
          <div className={cn("grid min-w-[26rem] grid-cols-[minmax(0,1fr)_7rem_6rem_4.5rem] gap-3 px-5", head)}>
            <span>{t("tables.class")}</span>
            <span className="text-right">{t("tables.revenue")}</span>
            <span className="text-right">{t("tables.daysOf")}</span>
            <span className="text-right">{t("tables.occupancy")}</span>
          </div>
          {classes.length === 0 ? (
            <p className="px-5 py-6 text-center text-sm text-muted">{t("tables.none")}</p>
          ) : (
            <ul className="divide-y divide-ink/[0.06]">
              {classes.map((row) => (
                <li key={row.classId ?? "none"} className="grid min-w-[26rem] grid-cols-[minmax(0,1fr)_7rem_6rem_4.5rem] gap-3 px-5 py-2.5 text-[13px]">
                  <span className="truncate">{locale === "zh" ? row.nameZh : row.name}</span>
                  <span className="text-right tabular-nums">{formatMoney(row.revenue)}</span>
                  <span className="text-right tabular-nums">
                    {row.rentedDays} / {row.availableDays}
                  </span>
                  <span className="text-right tabular-nums">{percent(row.occupancy)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section className="card mt-3 overflow-x-auto">
        <div className={cn("grid min-w-[26rem] grid-cols-[minmax(0,1fr)_7rem_7rem_7rem] gap-3 px-5", head)}>
          <span>{t("tables.store")}</span>
          <span className="text-right">{t("tables.revenue")}</span>
          <span className="text-right">{t("tables.costs")}</span>
          <span className="text-right">{t("tables.contribution")}</span>
        </div>
        {stores.length === 0 ? (
          <p className="px-5 py-6 text-center text-sm text-muted">{t("setup.empty")}</p>
        ) : (
          <ul className="divide-y divide-ink/[0.06]">
            {stores.map((row) => (
              <li key={row.locationId ?? "none"} className="grid min-w-[26rem] grid-cols-[minmax(0,1fr)_7rem_7rem_7rem] gap-3 px-5 py-2.5 text-[13px]">
                <span className="truncate">{row.locationId ? (storeNames.get(row.locationId) ?? "—") : t("tables.noStore")}</span>
                <span className="text-right tabular-nums">{formatMoney(row.revenue)}</span>
                <span className="text-right tabular-nums">{formatMoney(row.costs)}</span>
                <span className="text-right tabular-nums">{formatMoney(row.contribution)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card mt-3 overflow-x-auto">
        <div className={cn(grid, head)}>
          <span>{t("tables.vehicle")}</span>
          <span className="text-right">{t("tables.revenue")}</span>
          <span className="text-right">{t("tables.ownerShare")}</span>
          <span className="text-right">{t("tables.costs")}</span>
          <span className="text-right">{t("tables.depreciation")}</span>
          <span className="text-right">{t("tables.contribution")}</span>
          <span className="text-right">{t("tables.occupancy")}</span>
        </div>
        {current.rows.length === 0 ? (
          <p className="px-5 py-6 text-center text-sm text-muted">{t("tables.none")}</p>
        ) : (
          <ul className="divide-y divide-ink/[0.06]">
            {section(t("tables.own"), own)}
            {section(t("tables.owner"), owned)}
            {total(t("parts.contribution"), current.contribution, true)}
            {total(t("parts.unassigned"), current.unassignedRevenue)}
            {total(t("parts.company"), 0 - current.companyCosts)}
            {total(t("parts.operating"), current.operatingProfit, true)}
          </ul>
        )}
      </section>
    </>
  );
}
