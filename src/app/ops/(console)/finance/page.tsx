import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Field";
import { PageHeader } from "@/components/ops/PageHeader";
import { markPriceReviewed } from "@/features/finance/actions";
import { loadFinance, loadVehicleReport, parseRange } from "@/features/finance/queries";
import { can, requirePagePermission } from "@/lib/auth/staff";
import { cn } from "@/lib/utils/cn";
import { formatDateTime, formatMoney } from "@/lib/utils/format";

export const metadata: Metadata = { title: "Finance" };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function FinancePage({ searchParams }: Props) {
  const session = await requirePagePermission("finance.view");
  const search = await searchParams;
  const range = parseRange(search);
  const onlyPending = search.review === "pending";
  const [t, r, { rows, summary }, vehicles] = await Promise.all([getTranslations("finance"), getTranslations("reservations"), loadFinance(range), loadVehicleReport(range)]);
  const visible = onlyPending ? rows.filter((row) => !row.price_reviewed_at && !["CANCELLED", "NO_SHOW", "EXPIRED"].includes(row.status)) : rows;
  const query = `from=${range.from}&to=${range.to}`;
  const tiles: Array<[string, string]> = [
    [t("count"), String(summary.count)],
    [t("receivable"), formatMoney(summary.receivableCents)],
    [t("collected"), formatMoney(summary.collectedCents)],
    [t("refunded"), formatMoney(summary.refundedCents)],
    [t("gap"), formatMoney(summary.receivableCents - summary.collectedCents)],
    [t("tax"), formatMoney(summary.taxCents)],
    [t("holds"), formatMoney(summary.holdCents)],
    [t("pendingReview"), String(summary.pendingReview)],
  ];
  const grid = "md:grid-cols-[7rem_minmax(0,1.4fr)_9rem_6rem_6rem_6rem_6rem_8rem]";

  return (
    <>
      <PageHeader
        title={t("title")}
        actions={
          can(session, "finance.export") ? (
            <span className="flex gap-2">
              <a href={`/finance/export?${query}&kind=reservations`} className="inline-flex h-8 items-center rounded-pill px-3.5 text-[13px] font-medium hairline hover:border-ink/25">
                {t("exportReservations")}
              </a>
              <a href={`/finance/export?${query}&kind=payments`} className="inline-flex h-8 items-center rounded-pill px-3.5 text-[13px] font-medium hairline hover:border-ink/25">
                {t("exportPayments")}
              </a>
            </span>
          ) : undefined
        }
      />
      <form className="mb-5 flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-[12px] text-muted">
          {t("from")}
          <Input type="date" name="from" defaultValue={range.from} className="h-9" />
        </label>
        <label className="flex flex-col gap-1 text-[12px] text-muted">
          {t("to")}
          <Input type="date" name="to" defaultValue={range.to} className="h-9" />
        </label>
        {onlyPending && <input type="hidden" name="review" value="pending" />}
        <Button type="submit" size="sm" variant="secondary">
          {t("apply")}
        </Button>
        <Link href={onlyPending ? `/finance?${query}` : `/finance?${query}&review=pending`} className={cn("rounded-pill px-3.5 py-1.5 text-[13px] hairline hover:border-ink/25", onlyPending && "bg-ink text-white")}>
          {t("pendingReview")}
        </Link>
      </form>
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {tiles.map(([label, value]) => (
          <div key={label} className="card px-5 py-4">
            <p className="text-xs text-muted">{label}</p>
            <p className="mt-1 text-xl font-semibold tabular-nums">{value}</p>
          </div>
        ))}
      </div>
      <div className="card overflow-hidden">
        <div className={`hidden gap-4 border-b border-ink/[0.07] bg-pearl/60 px-5 py-2.5 text-[11px] font-medium tracking-[0.12em] text-muted uppercase md:grid ${grid}`}>
          <span>{r("columns.number")}</span>
          <span>{r("columns.customer")}</span>
          <span>{t("pickup")}</span>
          <span>{r("columns.status")}</span>
          <span className="text-right">{t("total")}</span>
          <span className="text-right">{t("paid")}</span>
          <span className="text-right">{t("refunds")}</span>
          <span className="text-right">{t("review")}</span>
        </div>
        {visible.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-muted">{t("empty")}</p>
        ) : (
          <ul className="divide-y divide-ink/[0.06]">
            {visible.map((row) => (
              <li key={row.id} className={`grid grid-cols-2 gap-x-4 gap-y-1 px-5 py-3 text-[13px] md:items-center ${grid}`}>
                <Link href={`/reservations/${row.id}`} className="font-medium hover:text-gold">
                  {row.number}
                </Link>
                <span className="truncate">{row.customer?.full_name ?? "—"}</span>
                <span className="text-muted">{formatDateTime(row.pickup_at)}</span>
                <span>
                  <Badge tone="neutral">{r(`status.${row.status}`)}</Badge>
                </span>
                <span className="tabular-nums md:text-right">{formatMoney(row.total_cents)}</span>
                <span className="tabular-nums md:text-right">{formatMoney(row.paid_cents)}</span>
                <span className="tabular-nums md:text-right">{row.refunded_cents ? formatMoney(row.refunded_cents) : "—"}</span>
                <span className="md:text-right">
                  {row.price_reviewed_at ? (
                    <Badge tone="success">{t("reviewed")}</Badge>
                  ) : can(session, "finance.review") && !["CANCELLED", "NO_SHOW", "EXPIRED"].includes(row.status) ? (
                    <form action={markPriceReviewed}>
                      <input type="hidden" name="reservationId" value={row.id} />
                      <Button type="submit" size="sm" variant="ghost">
                        {t("markReviewed")}
                      </Button>
                    </form>
                  ) : (
                    <Badge tone="warning">{t("unreviewed")}</Badge>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
      {vehicles.length > 0 && (
        <section className="card mt-5 overflow-hidden">
          <div className="grid grid-cols-[minmax(0,1fr)_5rem_5rem_7rem_6rem] gap-4 border-b border-ink/[0.07] bg-pearl/60 px-5 py-2.5 text-[11px] font-medium tracking-[0.12em] text-muted uppercase">
            <span>{t("byVehicle")}</span>
            <span className="text-right">{t("rentals")}</span>
            <span className="text-right">{t("days")}</span>
            <span className="text-right">{t("revenue")}</span>
            <span className="text-right">{t("utilization")}</span>
          </div>
          <ul className="divide-y divide-ink/[0.06]">
            {vehicles.map((row) => (
              <li key={row.vehicle_id} className="grid grid-cols-[minmax(0,1fr)_5rem_5rem_7rem_6rem] gap-4 px-5 py-2.5 text-[13px]">
                <Link href={`/fleet/${row.vehicle_id}`} className="font-medium hover:text-gold">
                  {row.fleet_number}
                </Link>
                <span className="text-right tabular-nums">{row.rentals}</span>
                <span className="text-right tabular-nums">{row.days}</span>
                <span className="text-right tabular-nums">{formatMoney(row.revenue_cents)}</span>
                <span className="text-right tabular-nums">{row.utilization}%</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
