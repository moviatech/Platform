import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/Badge";
import { CsvLink } from "@/components/ops/CsvLink";
import { PageHeader } from "@/components/ops/PageHeader";
import { zonedParts } from "@/features/booking/time";
import { FinanceTabs } from "@/features/finance/FinanceTabs";
import { SettlementForm, VoidSettlementForm } from "@/features/finance/RecurringForms";
import { owedBalances, settlementKinds } from "@/features/finance/recurring";
import { listSettlements, loadOwedSources } from "@/features/finance/recurring-queries";
import { can, requirePagePermission } from "@/lib/auth/staff";
import { cn } from "@/lib/utils/cn";
import { formatMoney } from "@/lib/utils/format";

export const metadata: Metadata = { title: "Repayments" };

export default async function SettlementsPage() {
  const session = await requirePagePermission("finance.view");
  const today = zonedParts(new Date(), "America/Los_Angeles").date;
  const [t, tabs, settlements, sources] = await Promise.all([getTranslations("expenses"), getTranslations("finance.tabs"), listSettlements(), loadOwedSources()]);
  const owed = owedBalances(sources, settlements);
  const record = can(session, "finance.review");
  const first = settlements.at(-1)?.paid_on ?? today;
  const grid = "md:grid-cols-[6.5rem_8rem_minmax(0,1fr)_7rem_7rem_8rem]";

  return (
    <>
      <PageHeader
        title={tabs("settlements")}
        actions={
          can(session, "finance.export") && settlements.length > 0 ? (
            <CsvLink href={`/finance/export?from=${first}&to=${today}&kind=settlements`}>
              {t("export")}
            </CsvLink>
          ) : undefined
        }
      />
      <FinanceTabs current="settlements" />
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {settlementKinds.map((kind) => (
          <div key={kind} className="card px-5 py-4">
            <p className="text-xs text-muted">{t(`owed.${kind}`)}</p>
            <p className={cn("mt-1 text-xl font-semibold tabular-nums", owed[kind] < 0 && "text-status-danger")}>{formatMoney(owed[kind])}</p>
          </div>
        ))}
      </div>
      {record && (
        <section className="card mb-6 px-5 py-5">
          <SettlementForm today={today} />
        </section>
      )}
      <div className="card overflow-hidden">
        <div className={`hidden gap-4 border-b border-ink/[0.07] bg-pearl/60 px-5 py-2.5 text-[11px] font-medium tracking-[0.12em] text-muted uppercase md:grid ${grid}`}>
          <span>{t("date")}</span>
          <span>{t("settlementKind")}</span>
          <span>{t("reference")}</span>
          <span>{t("by")}</span>
          <span className="text-right">{t("amount")}</span>
          <span />
        </div>
        {settlements.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-muted">{t("settlementEmpty")}</p>
        ) : (
          <ul className="divide-y divide-ink/[0.06]">
            {settlements.map((item) => (
              <li key={item.id} className={cn(`grid grid-cols-2 gap-x-4 gap-y-1 px-5 py-3 text-[13px] md:items-center ${grid}`, item.voided_at && "opacity-50")}>
                <span className="text-muted">{item.paid_on}</span>
                <span>{t(`settlementKinds.${item.kind}`)}</span>
                <span className="min-w-0 truncate">
                  {item.reference ?? "—"}
                  {item.note && <span className="text-muted"> · {item.note}</span>}
                  {item.void_reason && <span className="text-status-danger"> · {item.void_reason}</span>}
                </span>
                <span className="truncate text-muted">{item.author?.display_name ?? "—"}</span>
                <span className={cn("font-medium tabular-nums md:text-right", item.voided_at && "line-through")}>{formatMoney(item.amount_cents)}</span>
                <span className="flex items-center gap-3 md:justify-end">{item.voided_at ? <Badge tone="neutral">{t("voided")}</Badge> : record ? <VoidSettlementForm id={item.id} /> : null}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
