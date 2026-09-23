import type { Metadata } from "next";
import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/Badge";
import { BackLink, withBack } from "@/components/ops/BackLink";
import { PageHeader } from "@/components/ops/PageHeader";
import { zonedParts } from "@/features/booking/time";
import { monthLabel } from "@/features/investor/earnings";
import { PlaceHoldForm, ReleaseHoldForm } from "@/features/investor/HoldForms";
import { listActiveHolds } from "@/features/investor/holds";
import { countOpenStatements, isMonthKey, listStatements, monthKey, previousMonth, type MileageStatement } from "@/features/investor/mileage";
import { AdjustmentForm, GenerateForm, IssueButton, ReadingForm, RemoveAdjustmentButton, RereadButton, ResolveForm, VoidButton } from "@/features/investor/MileageForms";
import { MonthPicker } from "@/features/investor/MonthPicker";
import { RowAction } from "@/features/investor/RowAction";
import { can, requirePagePermission } from "@/lib/auth/staff";
import { cn } from "@/lib/utils/cn";
import { formatDate, formatDateTime, formatMoney } from "@/lib/utils/format";

export const metadata: Metadata = { title: "Mileage statements" };

type Props = { searchParams: Promise<{ month?: string; view?: string }> };

const grid = "md:grid-cols-[minmax(0,1.3fr)_5.5rem_8rem_6rem_6rem_4.5rem_5.5rem_4.5rem_6rem_7rem_4.5rem]";
const head = "hidden gap-3 border-b border-ink/[0.07] bg-pearl/60 px-4 py-2 text-[11px] font-medium tracking-[0.12em] text-muted uppercase md:grid";
const cell = "grid gap-x-3 gap-y-1 px-4 py-2.5 text-[13px] md:items-center";
const statusTone: Record<string, "neutral" | "gold" | "success" | "warning" | "danger" | "info"> = { DRAFT: "warning", ISSUED: "info", DISPUTED: "danger", SETTLED: "success", VOID: "neutral" };

export default async function MileagePage({ searchParams }: Props) {
  const session = await requirePagePermission("investor.view");
  const { month: raw, view } = await searchParams;
  const current = zonedParts(new Date(), "America/Los_Angeles").date.slice(0, 7);
  const month = isMonthKey(raw) ? raw : previousMonth(current);
  const open = view === "open";
  const [t, locale, statements, openCount, holds] = await Promise.all([getTranslations("investors.mileage"), getLocale(), open ? listStatements({ statuses: ["DRAFT", "DISPUTED"], limit: 300 }) : listStatements({ month }), countOpenStatements(), listActiveHolds()]);
  const finance = can(session, "investor.finance");
  const manage = can(session, "investor.manage");
  const entryHolds = new Map(holds.filter((hold) => hold.scope === "ENTRY" && hold.entry_id).map((hold) => [hold.entry_id as string, hold]));
  const reading = (value: number | null, source: string | null) => (value === null ? "—" : `${value.toLocaleString("en-US")}${source ? ` · ${t(`sources.${source}`)}` : ""}`);
  const back = open ? "/investors/mileage?view=open" : `/investors/mileage?month=${month}`;

  const actions = (statement: MileageStatement) => {
    const hold = statement.entry_id ? entryHolds.get(statement.entry_id) : undefined;
    const adjustable = statement.status === "DRAFT" || statement.status === "ISSUED";
    return (
      <div className="flex flex-col gap-3">
        {statement.status === "DRAFT" && (
          <div className="flex flex-wrap items-center gap-3">
            <RereadButton id={statement.id} />
            <ReadingForm id={statement.id} which="start" defaultValue={statement.start_reading} />
            <ReadingForm id={statement.id} which="end" defaultValue={statement.end_reading} />
          </div>
        )}
        {statement.adjustments.length > 0 && (
          <ul className="flex flex-col gap-1 text-[12px]">
            {statement.adjustments.map((item) => (
              <li key={item.id} className="flex flex-wrap items-center gap-2">
                <span className={cn("font-medium tabular-nums", item.miles < 0 ? "text-status-danger" : "text-ink")}>{item.miles > 0 ? "+" : ""}{item.miles.toLocaleString("en-US")} mi</span>
                <Badge tone="neutral">{t(`kinds.${item.kind}`)}</Badge>
                <span className="text-charcoal">{item.reason}</span>
                <span className="text-muted">{formatDateTime(item.created_at)}{item.author?.display_name ? ` · ${item.author.display_name}` : ""}</span>
                {statement.status === "DRAFT" && <RemoveAdjustmentButton id={item.id} />}
              </li>
            ))}
          </ul>
        )}
        {adjustable && <AdjustmentForm id={statement.id} />}
        {statement.status === "DISPUTED" && (
          <div className="flex flex-col gap-2 text-[12px]">
            <p className="text-charcoal">
              {t("dispute", { miles: statement.disputed_miles, note: statement.dispute_note ?? "" })}
              {statement.disputed_at ? <span className="text-muted"> · {t("disputedAt", { date: formatDateTime(statement.disputed_at) })}</span> : null}
            </p>
            <ResolveForm id={statement.id} disputedMiles={statement.disputed_miles} />
          </div>
        )}
        <div className="flex flex-wrap items-center gap-4">
          {statement.status === "DRAFT" && statement.start_reading !== null && statement.end_reading !== null && <IssueButton id={statement.id} />}
          {statement.status === "DRAFT" && <VoidButton id={statement.id} />}
          {manage && statement.entry_id && (statement.status === "ISSUED" || statement.status === "DISPUTED") && (hold ? (
            <span className="flex flex-wrap items-center gap-2">
              <Badge tone="warning">{hold.reason}</Badge>
              <ReleaseHoldForm id={hold.id} compact />
            </span>
          ) : (
            <PlaceHoldForm scope="ENTRY" target={statement.entry_id} compact />
          ))}
        </div>
      </div>
    );
  };

  return (
    <>
      <BackLink href="/investors" />
      <PageHeader
        title={t("title")}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Link href="/investors/mileage?view=open" className={cn("rounded-pill px-3.5 py-1.5 text-[13px] font-medium", open ? "bg-ink text-white" : "bg-white text-charcoal hairline hover:border-ink/25")}>
              {t("open")}
              {openCount > 0 ? ` · ${openCount}` : ""}
            </Link>
            <MonthPicker month={month} label={monthLabel(month, locale)} base="/investors/mileage" max={current} />
            {finance && !open && <GenerateForm month={month} />}
          </div>
        }
      />
      {statements.length === 0 ? (
        <div className="card px-6 py-14 text-center text-sm text-muted">{t("none")}</div>
      ) : (
        <div className="card overflow-hidden">
          <div className={cn(head, grid)}>
            <span>{t("columns.investor")}</span>
            <span>{t("columns.vehicle")}</span>
            <span>{t("columns.period")}</span>
            <span>{t("columns.start")}</span>
            <span>{t("columns.end")}</span>
            <span className="text-right">{t("columns.adjustments")}</span>
            <span className="text-right">{t("columns.miles")}</span>
            <span className="text-right">{t("columns.rate")}</span>
            <span className="text-right">{t("columns.amount")}</span>
            <span>{t("columns.status")}</span>
            <span>{t("columns.actions")}</span>
          </div>
          <ul className="divide-y divide-ink/[0.06]">
            {statements.map((statement) => (
              <li key={statement.id} className={cn(cell, grid)}>
                <Link href={withBack(`/investors/${statement.investor_id}`, back)} className="truncate font-medium hover:text-gold">
                  {statement.investor?.legal_name} · {statement.investor?.investor_number}
                </Link>
                <Link href={withBack(`/fleet/${statement.vehicle_id}`, back)} className="truncate hover:text-gold">
                  {statement.vehicle?.fleet_number}
                </Link>
                <span className="text-muted">
                  {open ? `${monthKey(statement)} · ` : ""}
                  {formatDate(statement.period_start)} – {formatDate(new Date(Date.parse(statement.period_end) - 1))}
                  {statement.final ? ` · ${t("final")}` : ""}
                </span>
                <span className="tabular-nums">{reading(statement.start_reading, statement.start_source)}</span>
                <span className="tabular-nums">{reading(statement.end_reading, statement.end_source)}</span>
                <span className={cn("text-right tabular-nums", statement.adjustment_miles < 0 && "text-status-danger")}>{statement.adjustment_miles === 0 ? "—" : `${statement.adjustment_miles > 0 ? "+" : ""}${statement.adjustment_miles.toLocaleString("en-US")}`}</span>
                <span className="text-right font-medium tabular-nums">{statement.qualifying_miles.toLocaleString("en-US")}</span>
                <span className="text-right tabular-nums text-muted">{formatMoney(statement.rate_cents)}</span>
                <span className="text-right font-semibold tabular-nums">{formatMoney(statement.amount_cents)}</span>
                <span className="flex flex-col items-start gap-1">
                  <Badge tone={statusTone[statement.status]}>{t(`status.${statement.status}`)}</Badge>
                  {statement.read_error && <span className="text-[11px] text-status-danger">{t.has(`readErrors.${statement.read_error}`) ? t(`readErrors.${statement.read_error}`) : statement.read_error}</span>}
                  {statement.entry_id && entryHolds.has(statement.entry_id) && <span className="text-[11px] text-[#a87415]">{t("held")}</span>}
                  {statement.status === "ISSUED" && statement.dispute_until && <span className="text-[11px] text-muted">{t("disputeUntil", { date: formatDate(statement.dispute_until) })}</span>}
                </span>
                {finance ? <RowAction label={t("handle")}>{actions(statement)}</RowAction> : <span />}
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}
