import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { currentTime } from "@/features/booking/time";
import { listBankAccounts, listWithdrawals } from "@/features/investor/banking";
import { CancelWithdrawalButton, WithdrawalForm } from "@/features/investor/FundsForms";
import { listEntries, loadBalances, type LedgerEntry } from "@/features/investor/ledger";
import { loadInvestorSettings } from "@/features/investor/settings";
import { StepUpGate } from "@/features/investor/StepUp";
import { Icon } from "@/features/portal/icons";
import { PageIntro, whitePill } from "@/features/portal/ui";
import { requireInvestor } from "@/lib/auth/investor";
import { hasStepUp } from "@/lib/auth/step-up";
import { cn } from "@/lib/utils/cn";
import { formatDate, formatMoney } from "@/lib/utils/format";

export const metadata: Metadata = { title: "Funds" };

type Props = { searchParams: Promise<{ view?: string; requested?: string }> };

const views = ["all", "earnings", "withdrawals", "capital"] as const;

function viewOf(entry: LedgerEntry) {
  if (entry.type === "RENTAL_SHARE" || (entry.type === "ADJUSTMENT" && entry.bucket !== "INVESTED")) return "earnings";
  if (entry.type === "WITHHELD" || entry.type === "WITHHOLD_RELEASE" || entry.type === "WITHDRAWAL") return "withdrawals";
  return "capital";
}

export default async function FundsPage({ searchParams }: Props) {
  const session = await requireInvestor();
  const { view: raw, requested } = await searchParams;
  const view = (views as readonly string[]).includes(raw ?? "") ? (raw as (typeof views)[number]) : "all";
  const [t, balances, accounts, withdrawals, entries, settings, verified] = await Promise.all([getTranslations("investor.funds"), loadBalances(session.investorId), listBankAccounts(session.investorId), listWithdrawals(session.investorId), listEntries(session.investorId, { limit: 300 }), loadInvestorSettings(), hasStepUp(session.userId)]);
  const open = withdrawals.filter((item) => item.status === "REQUESTED" || item.status === "APPROVED");
  const visible = entries.filter((entry) => entry.bucket !== "INVESTED" && entry.type !== "WITHHOLD_RELEASE" && (view === "all" || viewOf(entry) === view) && !(view === "all" && entry.type === "WITHHELD" && withdrawals.find((item) => item.id === entry.withdrawal_id)?.status === "PAID"));
  const statusOf = (entry: LedgerEntry) => {
    if (entry.type === "WITHHELD") {
      const withdrawal = withdrawals.find((item) => item.id === entry.withdrawal_id);
      return withdrawal ? t(`withdrawalStatus.${withdrawal.status}`) : t("entryStatus.processing");
    }
    if (entry.type === "WITHDRAWAL") return t("withdrawalStatus.PAID");
    if (entry.bucket === "PENDING") return entry.settles_at ? t("entryStatus.pendingOn", { date: formatDate(entry.settles_at) }) : t("entryStatus.pending");
    return t("entryStatus.settled");
  };
  const labelOf = (entry: LedgerEntry) => {
    if (entry.type === "RENTAL_SHARE") return t("labels.share", { number: entry.reservation?.number ?? "", vehicle: entry.vehicle?.fleet_number ?? "" });
    if (entry.type === "WITHHELD" || entry.type === "WITHDRAWAL") return t("labels.withdrawal", { account: entry.memo ?? "" });
    if (entry.type === "CAPITAL_IN") return t("labels.capitalIn");
    if (entry.type === "CAPITAL_ALLOCATED") return t("labels.allocated", { vehicle: entry.vehicle?.fleet_number ?? entry.memo ?? "" });
    if (entry.type === "CAPITAL_RETURN") return t("labels.returned", { vehicle: entry.vehicle?.fleet_number ?? "" });
    if (entry.type === "REVERSAL") return t("labels.reversal", { memo: entry.memo ?? "" });
    return entry.memo ?? t("labels.adjustment");
  };
  const stats = [
    { label: t("pending"), value: formatMoney(balances.pendingCents), body: t("pendingBody") },
    { label: t("processing"), value: formatMoney(balances.heldCents), body: open.length ? t("processingBody", { count: open.length }) : t("processingNone") },
    { label: t("withdrawn"), value: formatMoney(balances.withdrawnCents), body: t("withdrawnBody") },
  ];
  return (
    <>
      <PageIntro title={t("title")} subtitle={t("subtitle")} />
      {requested && <p className="mb-4 rounded-xl bg-status-available/10 px-4 py-3 text-[13px]">{t("requested")}</p>}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <section className="card p-6">
          <div className="flex flex-wrap items-start justify-between gap-4 bg-[radial-gradient(60%_80%_at_0%_0%,rgba(181,139,75,0.08),transparent_70%)]">
            <div>
              <p className="flex items-center gap-1.5 text-[13px] text-muted">
                {t("available")}
                <Icon name="help" size={13} />
              </p>
              <p className="mt-1 text-[3rem] leading-none font-semibold tracking-tight">{formatMoney(balances.availableCents)}</p>
              <p className="mt-2 text-[13px] text-muted">{t("availableBody")}</p>
            </div>
            <Link href="/invest" className={whitePill}>
              {t("reinvest")}
            </Link>
          </div>
          <dl className="mt-6 grid gap-4 border-t border-ink/[0.07] pt-5 sm:grid-cols-3 sm:divide-x sm:divide-ink/[0.07]">
            {stats.map((stat) => (
              <div key={stat.label} className="sm:px-4 sm:first:pl-0">
                <dt className="text-[13px] text-muted">{stat.label}</dt>
                <dd className="text-[1.6rem] leading-tight font-semibold tracking-tight">{stat.value}</dd>
                <dd className="text-[12px] text-muted">{stat.body}</dd>
              </div>
            ))}
          </dl>
        </section>
        <section className="card p-6">
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2 className="text-[17px] font-semibold tracking-tight">{t("withdrawTitle")}</h2>
            <Link href="/account#accounts" className="flex items-center gap-1 text-[12px] text-muted hover:text-ink">
              {t("manageAccounts")}
              <Icon name="chevron" size={12} />
            </Link>
          </div>
          {accounts.length === 0 ? (
            <div className="rounded-xl bg-[#f7f4ee] p-5 text-[13px]">
              <p>{t("noAccounts")}</p>
              <Link href="/account#accounts" className={`${whitePill} mt-3`}>
                {t("addAccount")}
              </Link>
            </div>
          ) : (
            <StepUpGate verified={verified} email={session.email}>
              <WithdrawalForm accounts={accounts} availableCents={balances.availableCents} minCents={settings.withdrawalMinCents} now={currentTime()} />
            </StepUpGate>
          )}
        </section>
      </div>
      {open.length > 0 && (
        <section className="card mt-4 p-6">
          <h2 className="mb-3 text-[15px] font-semibold tracking-tight">{t("openTitle")}</h2>
          <ul className="divide-y divide-ink/[0.06] text-[13px]">
            {open.map((item) => (
              <li key={item.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2.5">
                <span className="w-24 text-muted">{formatDate(item.created_at)}</span>
                <span className="font-semibold tabular-nums">{formatMoney(item.amount_cents)}</span>
                <span className="text-charcoal">
                  {item.bank_account?.bank_name} •••• {item.bank_account?.last4}
                </span>
                <span className={cn("inline-flex h-6 items-center rounded-pill px-2.5 text-[11px] font-medium", item.status === "APPROVED" ? "bg-status-info/10 text-status-info" : "bg-status-limited/15 text-[#a87415]")}>{t(`withdrawalStatus.${item.status}`)}</span>
                {item.status === "REQUESTED" && <CancelWithdrawalButton id={item.id} />}
              </li>
            ))}
          </ul>
        </section>
      )}
      <section className="card mt-4 p-6">
        <h2 className="mb-4 text-[17px] font-semibold tracking-tight">{t("records")}</h2>
        <div className="mb-4 flex gap-1">
          {views.map((item) => (
            <Link key={item} href={item === "all" ? "/funds" : `/funds?view=${item}`} className={cn("rounded-pill px-3.5 py-1.5 text-[13px] font-medium", view === item ? "bg-[#f1ebe0] text-ink" : "text-charcoal hover:bg-pearl")}>
              {t(`views.${item}`)}
            </Link>
          ))}
        </div>
        {visible.length === 0 ? (
          <p className="text-[13px] text-muted">{t("recordsEmpty")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[36rem] text-[13px]">
              <thead>
                <tr className="border-b border-ink/[0.07] text-left text-[11px] tracking-[0.12em] text-muted uppercase">
                  <th className="py-2 pr-3 font-medium">{t("columns.date")}</th>
                  <th className="py-2 pr-3 font-medium">{t("columns.type")}</th>
                  <th className="py-2 pr-3 font-medium">{t("columns.description")}</th>
                  <th className="py-2 pr-3 text-right font-medium">{t("columns.amount")}</th>
                  <th className="py-2 font-medium">{t("columns.status")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink/[0.06]">
                {visible.map((entry) => {
                  const kind = viewOf(entry);
                  const positive = entry.amount_cents >= 0 && entry.type !== "WITHDRAWAL";
                  return (
                    <tr key={entry.id}>
                      <td className="py-2.5 pr-3 whitespace-nowrap text-muted">{formatDate(entry.created_at)}</td>
                      <td className="py-2.5 pr-3">
                        <span className="flex items-center gap-2">
                          <span className={cn("flex size-6 items-center justify-center rounded-full", positive ? "bg-status-available/12 text-status-available" : "bg-status-danger/10 text-status-danger")}>
                            <Icon name="arrow" size={12} className={positive ? "-rotate-90" : "rotate-90"} />
                          </span>
                          {t(`views.${kind}`)}
                        </span>
                      </td>
                      <td className="py-2.5 pr-3 text-charcoal">{labelOf(entry)}</td>
                      <td className={cn("py-2.5 pr-3 text-right font-medium tabular-nums", positive ? "text-status-available" : "text-status-danger")}>{entry.type === "WITHDRAWAL" ? "−" : entry.amount_cents < 0 ? "−" : "+"}{formatMoney(Math.abs(entry.amount_cents))}</td>
                      <td className="py-2.5">
                        <span className="inline-flex h-6 items-center rounded-pill bg-pearl px-2.5 text-[11px] font-medium text-charcoal">{statusOf(entry)}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-4 flex items-center gap-1.5 text-[12px] text-muted">
          <Icon name="help" size={13} />
          {t("investedNote")}
        </p>
      </section>
    </>
  );
}
