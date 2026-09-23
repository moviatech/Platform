import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/ops/PageHeader";
import { BankBalanceForm, DeleteBankBalance, VehicleCostsForm } from "@/features/finance/board/BoardForms";
import { isStoredEvidence } from "@/features/finance/board/evidence";
import { loadBankBalances, loadFleet } from "@/features/finance/board/queries";
import { LedgerStatus, LedgerTabs } from "@/features/finance/ledger/LedgerChrome";
import { laDate } from "@/features/finance/ledger/dates";
import { can, requirePagePermission } from "@/lib/auth/staff";
import { cn } from "@/lib/utils/cn";
import { formatDateTime, formatMoney } from "@/lib/utils/format";

export const metadata: Metadata = { title: "Dashboard setup" };

export default async function BoardSetupPage() {
  const session = await requirePagePermission("finance.view");
  const now = new Date();
  const today = laDate(now);
  const [t, locale, fleet, balances] = await Promise.all([getTranslations("finance.board"), getLocale(), loadFleet(today, today, now), loadBankBalances()]);
  const canEdit = can(session, "finance.ledger");
  const latest = new Map<string, (typeof balances)[number]>();
  for (const row of balances) if (!latest.has(row.account_name)) latest.set(row.account_name, row);
  const grid = "grid min-w-[34rem] grid-cols-[minmax(0,1fr)_7rem_8rem_6rem] gap-3 px-5";

  return (
    <>
      <PageHeader title={t("title")} actions={<LedgerStatus />} />
      <LedgerTabs group="board" current="setup" />

      <h2 className="mb-2 text-[15px] font-semibold">{t("setup.vehicles")}</h2>
      {fleet.vehicles.length === 0 ? (
        <p className="card px-5 py-6 text-center text-sm text-muted">{t("tables.none")}</p>
      ) : (
        <div className="space-y-3">
          {fleet.vehicles.map((vehicle) => (
            <details key={vehicle.id} className="card p-4" open={!vehicle.inServiceOn && canEdit}>
              <summary className="flex cursor-pointer list-none flex-wrap items-baseline gap-x-4 gap-y-1 [&::-webkit-details-marker]:hidden">
                <span className="text-[14px] font-semibold">{vehicle.fleetNumber ?? vehicle.plate ?? vehicle.id.slice(0, 8)}</span>
                <span className="text-[12px] text-muted">{locale === "zh" ? (vehicle.classNameZh ?? vehicle.className) : vehicle.className}</span>
                <span className="text-[12px] text-muted tabular-nums">
                  {t("setup.inServiceOn")} {vehicle.inServiceOn ?? `— (${vehicle.createdOn})`}
                </span>
                {vehicle.retiredOn ? (
                  <span className="text-[12px] text-muted tabular-nums">
                    {t("setup.retiredOn")} {vehicle.retiredOn}
                  </span>
                ) : vehicle.ownerExitOn ? (
                  <span className="text-[12px] text-status-limited tabular-nums">
                    {t("setup.ownerExit")} {vehicle.ownerExitOn}
                  </span>
                ) : null}
                {vehicle.purchasePriceCents !== null && (
                  <span className="text-[12px] text-muted tabular-nums">
                    {t("setup.purchasePrice")} {formatMoney(vehicle.purchasePriceCents)}
                  </span>
                )}
                {vehicle.monthlyPaymentCents !== null && (
                  <span className="text-[12px] text-muted tabular-nums">
                    {t("setup.monthlyPayment")} {formatMoney(vehicle.monthlyPaymentCents)}
                  </span>
                )}
                {vehicle.ownerCar && <span className="text-[12px] text-muted">{t("tables.owner")}</span>}
              </summary>
              {canEdit ? (
                <div className="mt-4">
                  <VehicleCostsForm
                    costs={{
                      vehicleId: vehicle.id,
                      inServiceOn: vehicle.inServiceOn,
                      retiredOn: vehicle.retiredOn,
                      purchasePriceCents: vehicle.purchasePriceCents,
                      depreciationMonths: vehicle.depreciationMonths,
                      residualCents: vehicle.residualCents,
                      monthlyPaymentCents: vehicle.monthlyPaymentCents,
                      purchaseTax: vehicle.purchaseTax,
                      evidenceStored: isStoredEvidence(vehicle.id, vehicle.taxEvidencePath),
                      evidenceNote: isStoredEvidence(vehicle.id, vehicle.taxEvidencePath) ? null : vehicle.taxEvidencePath,
                      insuranceMonthlyCents: vehicle.insuranceMonthlyCents,
                      registrationYearlyCents: vehicle.registrationYearlyCents,
                    }}
                  />
                </div>
              ) : null}
            </details>
          ))}
        </div>
      )}

      <h2 className="mb-2 mt-8 text-[15px] font-semibold">
        {t("setup.bank")} <span className="ml-2 text-[12px] font-normal text-muted">{t("cash.manual")}</span>
      </h2>
      {canEdit && (
        <div className="card mb-3 p-4">
          <BankBalanceForm accounts={[...latest.keys()]} today={today} />
        </div>
      )}
      <section className="card overflow-x-auto">
        <div className={cn(grid, "border-b border-ink/[0.07] bg-pearl/60 py-2.5 text-[11px] font-medium tracking-[0.12em] text-muted uppercase")}>
          <span>{t("setup.accountName")}</span>
          <span>{t("setup.asOf")}</span>
          <span className="text-right">{t("setup.balance")}</span>
          <span />
        </div>
        {balances.length === 0 ? (
          <p className="px-5 py-6 text-center text-sm text-muted">{t("setup.empty")}</p>
        ) : (
          <ul className="divide-y divide-ink/[0.06]">
            {balances.map((row) => (
              <li key={row.id} className={cn(grid, "items-center py-2 text-[13px]", latest.get(row.account_name)?.id !== row.id && "text-muted")}>
                <span className="truncate" title={formatDateTime(row.entered_at)}>
                  {row.account_name}
                </span>
                <span className="tabular-nums">{row.as_of}</span>
                <span className="text-right tabular-nums">{formatMoney(row.balance_cents)}</span>
                <span className="flex justify-end">{canEdit && <DeleteBankBalance id={row.id} />}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
