import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Field";
import { PageHeader } from "@/components/ops/PageHeader";
import { zonedParts } from "@/features/booking/time";
import { FinanceTabs } from "@/features/finance/FinanceTabs";
import { isMonth, monthRange } from "@/features/finance/report";
import { StripeSyncButton } from "@/features/finance/StripeSyncButton";
import { loadStripeMonth } from "@/features/finance/stripe-sync";
import { can, requirePagePermission } from "@/lib/auth/staff";
import { cn } from "@/lib/utils/cn";
import { formatDate, formatDateTime, formatMoney } from "@/lib/utils/format";

export const metadata: Metadata = { title: "Stripe" };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function StripePage({ searchParams }: Props) {
  const session = await requirePagePermission("finance.view");
  const search = await searchParams;
  const thisMonth = zonedParts(new Date(), "America/Los_Angeles").date.slice(0, 7);
  const month = isMonth(search.month) ? search.month : thisMonth;
  const [t, data] = await Promise.all([getTranslations("finance.stripe"), loadStripeMonth(month)]);
  const range = monthRange(month);
  const tiles: Array<[string, string]> = [
    [t("charges"), formatMoney(data.summary.chargesCents)],
    [t("refunds"), formatMoney(data.summary.refundsCents)],
    [t("fees"), formatMoney(data.summary.feesCents)],
    [t("net"), formatMoney(data.summary.netCents)],
    [t("paidOut"), formatMoney(data.summary.payoutsCents)],
    [t("balance"), data.balance ? formatMoney(data.balance.availableCents + data.balance.pendingCents) : "—"],
  ];
  const payoutGrid = "grid grid-cols-[minmax(0,1fr)_8rem_7rem_6rem] gap-4 px-5";
  const diffGrid = "grid min-w-[40rem] grid-cols-[9rem_minmax(0,1fr)_8rem_8rem_8rem] gap-4 px-5";

  return (
    <>
      <PageHeader
        eyebrow={data.syncedAt ? `${t("synced")} ${formatDateTime(data.syncedAt)}` : undefined}
        title="Stripe"
        actions={
          <span className="flex items-center gap-2">
            {data.configured && !data.live && <Badge tone="warning">{t("testMode")}</Badge>}
            {can(session, "finance.export") && (
              <a href={`/finance/export?from=${range.from}&to=${range.to}&kind=stripe`} className="inline-flex h-8 items-center rounded-pill px-3.5 text-[13px] font-medium hairline hover:border-ink/25">
                {t("export")}
              </a>
            )}
            {can(session, "finance.review") && <StripeSyncButton full={!data.syncedAt} />}
          </span>
        }
      />
      <FinanceTabs current="stripe" />
      <form className="mb-5 flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-[12px] text-muted">
          {t("month")}
          <Input type="month" name="month" defaultValue={month} max={thisMonth} className="h-9" />
        </label>
        <Button type="submit" size="sm" variant="secondary">
          {t("apply")}
        </Button>
      </form>
      {!data.configured ? (
        <p className="card px-5 py-10 text-center text-sm text-muted">{t("errors.not_configured")}</p>
      ) : (
        <>
          <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {tiles.map(([label, value]) => (
              <div key={label} className="card px-5 py-4">
                <p className="text-xs text-muted">{label}</p>
                <p className="mt-1 text-xl font-semibold tabular-nums">{value}</p>
              </div>
            ))}
          </div>
          <section className="card mb-6 overflow-hidden">
            <div className={cn(payoutGrid, "border-b border-ink/[0.07] bg-pearl/60 py-2.5 text-[11px] font-medium tracking-[0.12em] text-muted uppercase")}>
              <span>{t("payouts")}</span>
              <span className="text-right">{t("amount")}</span>
              <span className="text-right">{t("items")}</span>
              <span className="text-right">{t("status")}</span>
            </div>
            {data.payouts.length === 0 ? (
              <p className="px-5 py-8 text-center text-sm text-muted">{t("noPayouts")}</p>
            ) : (
              <ul className="divide-y divide-ink/[0.06]">
                {data.payouts.map((payout) => (
                  <li key={payout.id} className={cn(payoutGrid, "py-2.5 text-[13px]")}>
                    <span>
                      {payout.arrival_date ? formatDate(payout.arrival_date) : "—"}
                      <span className="ml-2 text-[11px] text-muted">{payout.id}</span>
                    </span>
                    <span className="text-right font-medium tabular-nums">{formatMoney(payout.amount_cents)}</span>
                    <span className="text-right tabular-nums">{payout.transactions || "—"}</span>
                    <span className="text-right">
                      <Badge tone={payout.status === "paid" ? "success" : payout.status === "failed" || payout.status === "canceled" ? "danger" : "warning"}>{payout.status}</Badge>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section className="card overflow-x-auto">
            <div className={cn(diffGrid, "border-b border-ink/[0.07] bg-pearl/60 py-2.5 text-[11px] font-medium tracking-[0.12em] text-muted uppercase")}>
              <span>
                {t("differences")} · {data.mismatches.length}
              </span>
              <span>{t("reference")}</span>
              <span>{t("order")}</span>
              <span className="text-right">Stripe</span>
              <span className="text-right">{t("system")}</span>
            </div>
            {data.mismatches.length === 0 ? (
              <p className="px-5 py-8 text-center text-sm text-muted">{t("allMatched", { count: data.matched })}</p>
            ) : (
              <ul className="divide-y divide-ink/[0.06]">
                {data.mismatches.slice(0, 100).map((item) => (
                  <li key={`${item.kind}:${item.reference}`} className={cn(diffGrid, "py-2.5 text-[13px]")}>
                    <span>
                      <Badge tone={item.kind === "AMOUNT" ? "danger" : "warning"}>{t(`kinds.${item.kind}`)}</Badge>
                    </span>
                    <span className="truncate text-muted">{item.reference}</span>
                    <span>{item.number ?? "—"}</span>
                    <span className="text-right tabular-nums">{item.stripeCents === null ? "—" : formatMoney(item.stripeCents)}</span>
                    <span className="text-right tabular-nums">{item.systemCents === null ? "—" : formatMoney(item.systemCents)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
          {data.mismatches.length === 0 ? null : (
            <p className="mt-3 text-[12px] text-muted">
              {t("matched", { count: data.matched })}
              {data.mismatches.length > 100 ? ` · ${t("more", { count: data.mismatches.length - 100 })}` : ""}
            </p>
          )}
        </>
      )}
    </>
  );
}
