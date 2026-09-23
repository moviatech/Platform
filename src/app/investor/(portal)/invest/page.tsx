import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import { cancelContribution } from "@/features/investor/contribution-actions";
import { listContributions } from "@/features/investor/contributions";
import { InvestForm } from "@/features/investor/InvestForms";
import { loadBalances } from "@/features/investor/ledger";
import { loadInvestorSettings } from "@/features/investor/settings";
import { PageIntro } from "@/features/portal/ui";
import { requireInvestor } from "@/lib/auth/investor";
import { cn } from "@/lib/utils/cn";
import { formatDate, formatMoney } from "@/lib/utils/format";

export const metadata: Metadata = { title: "Invest" };

type Props = { searchParams: Promise<{ submitted?: string }> };

const statusTone: Record<string, string> = { REQUESTED: "bg-status-limited/15 text-[#a87415]", CONFIRMED: "bg-status-available/12 text-status-available", DECLINED: "bg-status-danger/10 text-status-danger", CANCELLED: "bg-ink/5 text-charcoal" };

export default async function InvestPage({ searchParams }: Props) {
  const session = await requireInvestor();
  const { submitted } = await searchParams;
  const [t, locale, balances, settings, contributions] = await Promise.all([getTranslations("investor.invest"), getLocale(), loadBalances(session.investorId), loadInvestorSettings(), listContributions(session.investorId)]);
  const steps = [t("stepChoose"), t("stepAmount"), t("stepAgreement"), t("stepAllocate")];
  return (
    <>
      <PageIntro title={t("title")} subtitle={t("subtitle")} />
      {submitted && <p className="mb-4 rounded-xl bg-status-available/10 px-4 py-3 text-[13px]">{t("submitted")}</p>}
      <InvestForm availableLabel={formatMoney(balances.availableCents)} minLabel={t("minAmount", { amount: formatMoney(settings.capitalMinCents) })} />
      <section className="card mt-4 flex flex-wrap items-center gap-4 px-6 py-4">
        {steps.map((label, index) => (
          <div key={label} className="flex items-center gap-3">
            <span className={cn("flex size-7 items-center justify-center rounded-full text-[12px] font-semibold", index === 0 ? "bg-gold text-white" : "border border-ink/15 text-charcoal")}>{index + 1}</span>
            <span className="text-[13px] font-medium">{label}</span>
            {index < steps.length - 1 && <span className="hidden h-px w-10 bg-ink/10 sm:block" />}
          </div>
        ))}
      </section>
      <section className="card mt-4 p-6">
        <h2 className="mb-4 text-[17px] font-semibold tracking-tight">{t("history")}</h2>
        {contributions.length === 0 ? (
          <p className="text-[13px] text-muted">{t("historyEmpty")}</p>
        ) : (
          <ul className="divide-y divide-ink/[0.06]">
            {contributions.map((item) => (
              <li key={item.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-3 text-[13px]">
                <span className="w-24 text-muted">{formatDate(item.created_at)}</span>
                <span className="w-20 font-medium">{t(`kind.${item.kind}`)}</span>
                <span className="min-w-0 flex-1 truncate">
                  {item.kind === "CAPITAL" ? formatMoney(item.received_cents ?? item.amount_cents) : `${item.vehicle_payload.year ?? ""} ${item.vehicle_payload.model ?? ""} · ${item.vehicle_payload.vin ?? ""}`}
                  {item.decision_note && <span className="text-muted"> · {item.decision_note}</span>}
                </span>
                <span className={cn("inline-flex h-6 items-center rounded-pill px-2.5 text-[11px] font-medium", statusTone[item.status])}>{t(`status.${item.status}`)}</span>
                {item.status === "REQUESTED" && (
                  <form action={cancelContribution}>
                    <input type="hidden" name="id" value={item.id} />
                    <button type="submit" className="text-[12px] text-muted hover:text-status-danger">
                      {t("cancel")}
                    </button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
      <p className="mt-4 text-[12px] text-muted">{locale === "zh" ? t("legalNote") : t("legalNote")}</p>
    </>
  );
}
