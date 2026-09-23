import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/Badge";
import { ButtonLink } from "@/components/ui/Button";
import { PageHeader } from "@/components/ops/PageHeader";
import { countOpenWithdrawals, listOpenWithdrawals } from "@/features/investor/banking";
import { countPendingContributions, listPendingContributions } from "@/features/investor/contributions";
import { countPendingExits, listOpenExits } from "@/features/investor/exits";
import { countActiveHolds } from "@/features/investor/holds";
import { countPendingInvestors } from "@/features/investor/ops-queries";
import { listInvestors, type InvestorFilter } from "@/features/investor/ops-queries";
import { statusTone } from "@/features/investor/ui";
import { can, requirePagePermission } from "@/lib/auth/staff";
import { cn } from "@/lib/utils/cn";
import { formatDate, formatDateTime, formatMoney } from "@/lib/utils/format";

export const metadata: Metadata = { title: "Investors" };

type Props = { searchParams: Promise<{ q?: string; view?: string }> };

const grid = "md:grid-cols-[7rem_minmax(0,1.3fr)_minmax(0,1.5fr)_8.5rem_6.5rem_9rem]";

export default async function InvestorsPage({ searchParams }: Props) {
  const session = await requirePagePermission("investor.view");
  const { q, view } = await searchParams;
  const requests = view === "requests";
  const filter: InvestorFilter = view === "pending" ? "pending" : view === "active" ? "active" : "all";
  const [t, common, investors, holdCount, pendingInvestors, pendingContributions, openWithdrawals, pendingExits] = await Promise.all([getTranslations("investors"), getTranslations("common"), listInvestors(filter, q), countActiveHolds(), countPendingInvestors(), countPendingContributions(), countOpenWithdrawals(), countPendingExits()]);
  const strip = [
    { label: t("pendingStrip.applications"), value: pendingInvestors, href: "/investors?view=pending" },
    { label: t("pendingStrip.contributions"), value: pendingContributions, href: "/investors?view=requests#contributions" },
    { label: t("pendingStrip.withdrawals"), value: openWithdrawals, href: "/investors?view=requests#withdrawals" },
    { label: t("pendingStrip.exits"), value: pendingExits, href: "/investors?view=requests#exits" },
    { label: t("pendingStrip.holds"), value: holdCount, href: "/investors/holds" },
  ];
  const [pendingRows, withdrawalRows, exitRows] = requests ? await Promise.all([listPendingContributions(), listOpenWithdrawals(), listOpenExits()]) : [[], [], []];
  const tabs: Array<InvestorFilter | "requests"> = ["all", "pending", "active", "requests"];

  return (
    <>
      <PageHeader
        title={t("title")}
        actions={
          <div className="flex items-center gap-2">
            <form action="/investors">
              <input type="hidden" name="view" value={filter} />
              <input type="search" name="q" defaultValue={q ?? ""} placeholder={t("search")} className="h-9 w-56 rounded-xl border border-ink/10 bg-white px-3 text-[13px] placeholder:text-muted/70 focus:border-gold/60 focus:outline-none focus:ring-4 focus:ring-gold/10" />
            </form>
            <ButtonLink href="/investors/holds" size="sm" variant="secondary">
              {t("holds.title")}
              {holdCount > 0 ? ` · ${holdCount}` : ""}
            </ButtonLink>
            {can(session, "investor.manage") && (
              <ButtonLink href="/investors/new" size="sm">
                {t("new")}
              </ButtonLink>
            )}
          </div>
        }
      />
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
        {strip.map((item) => (
          <Link key={item.label} href={item.href} className={cn("card px-4 py-3 transition-shadow hover:shadow-lift", item.value > 0 && "border-gold/40")}>
            <p className="text-xs text-muted">{item.label}</p>
            <p className={cn("mt-0.5 text-xl font-semibold tabular-nums", item.value > 0 ? "text-gold" : "text-ink")}>{item.value}</p>
          </Link>
        ))}
      </div>
      <div className="mb-4 flex gap-1">
        {tabs.map((tab) => (
          <Link key={tab} href={`/investors?view=${tab}`} className={cn("rounded-pill px-3.5 py-1.5 text-[13px] font-medium", (requests ? tab === "requests" : filter === tab) ? "bg-ink text-white" : "bg-white text-charcoal hairline hover:border-ink/25")}>
            {t(`tabs.${tab}`)}
          </Link>
        ))}
      </div>
      {requests ? (
        <div className="flex flex-col gap-5">
          <section id="contributions" className="card overflow-hidden">
            <h2 className="border-b border-ink/[0.07] bg-pearl/60 px-5 py-2.5 text-[11px] font-medium tracking-[0.12em] text-muted uppercase">{t("pendingStrip.contributions")}</h2>
            {pendingRows.length === 0 ? <p className="px-5 py-6 text-[13px] text-muted">{common("empty")}</p> : (
              <ul className="divide-y divide-ink/[0.06]">
                {pendingRows.map((item) => (
                  <li key={item.id}>
                    <Link href={`/investors/${item.investor_id}?back=${encodeURIComponent("/investors?view=requests")}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3 text-[13px] hover:bg-gold/[0.04]">
                      <span className="w-24 text-muted">{formatDate(item.created_at)}</span>
                      <span className="font-medium">{item.investor?.legal_name} · {item.investor?.investor_number}</span>
                      <Badge tone={item.kind === "CAPITAL" ? "gold" : "info"}>{t(`contributions.kind.${item.kind}`)}</Badge>
                      <span className="tabular-nums">{item.kind === "CAPITAL" ? formatMoney(item.amount_cents) : `${item.vehicle_payload.year ?? ""} ${item.vehicle_payload.model ?? ""}`}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section id="withdrawals" className="card overflow-hidden">
            <h2 className="border-b border-ink/[0.07] bg-pearl/60 px-5 py-2.5 text-[11px] font-medium tracking-[0.12em] text-muted uppercase">{t("pendingStrip.withdrawals")}</h2>
            {withdrawalRows.length === 0 ? <p className="px-5 py-6 text-[13px] text-muted">{common("empty")}</p> : (
              <ul className="divide-y divide-ink/[0.06]">
                {withdrawalRows.map((item) => (
                  <li key={item.id}>
                    <Link href={`/investors/${item.investor_id}?back=${encodeURIComponent("/investors?view=requests")}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3 text-[13px] hover:bg-gold/[0.04]">
                      <span className="w-24 text-muted">{formatDate(item.created_at)}</span>
                      <span className="font-medium">{item.investor?.legal_name} · {item.investor?.investor_number}</span>
                      <span className="font-semibold tabular-nums">{formatMoney(item.amount_cents)}</span>
                      <span className="text-muted">{item.bank_account?.bank_name} •••• {item.bank_account?.last4}</span>
                      <Badge tone={item.status === "APPROVED" ? "info" : "warning"}>{t(`payouts.status.${item.status}`)}</Badge>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section id="exits" className="card overflow-hidden">
            <h2 className="border-b border-ink/[0.07] bg-pearl/60 px-5 py-2.5 text-[11px] font-medium tracking-[0.12em] text-muted uppercase">{t("pendingStrip.exits")}</h2>
            {exitRows.length === 0 ? <p className="px-5 py-6 text-[13px] text-muted">{common("empty")}</p> : (
              <ul className="divide-y divide-ink/[0.06]">
                {exitRows.map((item) => (
                  <li key={item.id}>
                    <Link href={`/investors/${item.investor_id}?back=${encodeURIComponent("/investors?view=requests")}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3 text-[13px] hover:bg-gold/[0.04]">
                      <span className="w-24 text-muted">{formatDate(item.created_at)}</span>
                      <span className="font-medium">{item.investor?.legal_name} · {item.investor?.investor_number}</span>
                      <span>{item.allocation?.vehicle?.fleet_number}</span>
                      <Badge tone="warning">{t(`exits.status.${item.status}`)}</Badge>
                      {item.reason && <span className="text-muted">{item.reason}</span>}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      ) : investors.length === 0 ? (
        <div className="card px-6 py-14 text-center text-sm text-muted">{common("empty")}</div>
      ) : (
        <div className="card overflow-hidden">
          <div className={`hidden gap-4 border-b border-ink/[0.07] bg-pearl/60 px-5 py-2.5 text-[11px] font-medium tracking-[0.12em] text-muted uppercase md:grid ${grid}`}>
            <span>{t("columns.number")}</span>
            <span>{t("columns.name")}</span>
            <span>{t("columns.email")}</span>
            <span>{t("columns.phone")}</span>
            <span>{t("columns.status")}</span>
            <span className="text-right">{t("columns.created")}</span>
          </div>
          <ul className="divide-y divide-ink/[0.06]">
            {investors.map((investor) => (
              <li key={investor.id}>
                <Link href={`/investors/${investor.id}`} className={`grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1 px-5 py-3.5 text-sm transition-colors hover:bg-gold/[0.04] md:items-center ${grid}`}>
                  <span className="font-mono text-[12px] text-muted">{investor.investor_number}</span>
                  <span className="truncate font-medium">{investor.legal_name}</span>
                  <span className="truncate text-[13px] text-charcoal">{investor.email}</span>
                  <span className="text-[13px] tabular-nums text-charcoal">{investor.phone}</span>
                  <span>
                    <Badge tone={statusTone[investor.status]}>{t(`status.${investor.status}`)}</Badge>
                  </span>
                  <span className="col-span-2 text-xs text-muted md:col-span-1 md:text-right">{formatDateTime(investor.created_at)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}
