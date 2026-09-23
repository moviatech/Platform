import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import { LocaleSwitch } from "@/components/ops/LocaleSwitch";
import { currentTime } from "@/features/booking/time";
import { toggleInvestorPreference } from "@/features/investor/account-actions";
import { InvestorPasswordForm } from "@/features/investor/AuthForms";
import { listBankAccounts } from "@/features/investor/banking";
import { BankAccountForm, RemoveAccountButton } from "@/features/investor/FundsForms";
import { loadInvestorPreferences, preferenceKeys } from "@/features/investor/preferences";
import { loadInvestorSettings } from "@/features/investor/settings";
import { StepUpGate } from "@/features/investor/StepUp";
import { InvestorSignInHistory } from "@/features/investor/SignInHistory";
import { Icon } from "@/features/portal/icons";
import { PageIntro, whitePill } from "@/features/portal/ui";
import { requireInvestor } from "@/lib/auth/investor";
import { hasStepUp } from "@/lib/auth/step-up";
import { cn } from "@/lib/utils/cn";
import { formatDate, formatDateTime } from "@/lib/utils/format";

export const metadata: Metadata = { title: "Account" };

export default async function InvestorAccountPage() {
  const session = await requireInvestor();
  const now = currentTime();
  const [t, a, locale, accounts, settings, verified, prefs] = await Promise.all([getTranslations("investor.account"), getTranslations("investor.funds.accounts"), getLocale(), listBankAccounts(session.investorId), loadInvestorSettings(), hasStepUp(session.userId), loadInvestorPreferences(session.investorId)]);
  const row = "flex items-center gap-3 rounded-xl bg-[#f7f4ee] px-4 py-3";
  return (
    <>
      <PageIntro title={t("title")} />
      <section className="card flex flex-wrap items-center gap-6 p-6 sm:p-8">
        <span className="flex size-20 items-center justify-center rounded-full bg-gold text-3xl font-medium text-white">{session.legalName.trim().slice(0, 1).toUpperCase()}</span>
        <div className="min-w-0 flex-1">
          <p className="text-[1.6rem] leading-tight font-medium tracking-tight">{session.legalName}</p>
          <p className="text-[13px] text-muted">
            {session.number} · {t("since", { date: formatDate(session.createdAt) })}
          </p>
          <p className="mt-3 flex items-center gap-2.5 text-[14px] text-charcoal">
            <Icon name="mail" size={16} className="text-gold" />
            {session.email}
          </p>
          <p className="mt-1.5 flex items-center gap-2.5 text-[14px] text-charcoal">
            <Icon name="phone" size={16} className="text-gold" />
            {session.phone}
          </p>
        </div>
        <p className="w-full text-[12px] text-muted sm:w-auto sm:max-w-xs sm:text-right">{t("changeContact")}</p>
      </section>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <section className="card p-6">
          <div className="flex items-start gap-3">
            <Icon name="lock" size={26} className="mt-0.5 shrink-0 text-gold" />
            <h2 className="text-[20px] font-medium tracking-tight">{t("security")}</h2>
          </div>
          <div className="mt-4 flex flex-col gap-2">
            <details className="group">
              <summary className={`${row} cursor-pointer list-none hover:bg-pearl`}>
                <Icon name="key" size={20} className="shrink-0 text-gold" />
                <span className="min-w-0 flex-1 text-[13px] font-semibold">{t("password")}</span>
                <span className={`${whitePill} h-8 px-3 text-[12px]`}>
                  {t("changePassword")}
                  <Icon name="chevron" size={13} className="transition-transform group-open:rotate-90" />
                </span>
              </summary>
              <div className="px-2 pt-4 pb-2">
                <InvestorPasswordForm />
              </div>
            </details>
            <div className={row}>
              <Icon name="shield" size={20} className="shrink-0 text-gold" />
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] font-semibold">{t("twoFactor")}</span>
                <span className="block text-[12px] text-muted">{t("twoFactorBody", { email: session.email })}</span>
              </span>
              <span className="rounded-pill bg-status-available/12 px-2.5 py-1 text-[11px] font-medium text-status-available">{t("alwaysOn")}</span>
            </div>
            <details className="group">
              <summary className={`${row} cursor-pointer list-none hover:bg-pearl`}>
                <Icon name="clock" size={20} className="shrink-0 text-gold" />
                <span className="min-w-0 flex-1 text-[13px] font-semibold">{t("signInActivity")}</span>
                <Icon name="chevron" size={13} className="text-muted transition-transform group-open:rotate-90" />
              </summary>
              <div className="pt-3 pb-1">
                <InvestorSignInHistory email={session.email} />
              </div>
            </details>
          </div>
        </section>

        <section className="card p-6">
          <div className="flex items-start gap-3">
            <Icon name="compass" size={26} className="mt-0.5 shrink-0 text-gold" />
            <h2 className="text-[20px] font-medium tracking-tight">{t("preferences")}</h2>
          </div>
          <div className="mt-4 flex flex-col gap-2">
            <div className={row}>
              <Icon name="globe" size={20} className="shrink-0 text-gold" />
              <span className="min-w-0 flex-1 text-[13px] font-semibold">{t("language")}</span>
              <LocaleSwitch label={t(locale === "zh" ? "toEnglish" : "toChinese")} className="border border-gold/40 bg-white text-ink hover:border-gold" />
            </div>
            {preferenceKeys.map((key) => (
              <form key={key} action={toggleInvestorPreference} className={row}>
                <input type="hidden" name="key" value={key} />
                <input type="hidden" name="value" value={prefs[key] ? "0" : "1"} />
                <Icon name="bell" size={20} className="shrink-0 text-gold" />
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] font-semibold">{t(`prefs.${key}`)}</span>
                  <span className="block text-[12px] text-muted">{t(`prefs.${key}Body`)}</span>
                </span>
                <span className="text-[12px] text-charcoal">{prefs[key] ? t("enabled") : t("disabled")}</span>
                <button type="submit" role="switch" aria-checked={prefs[key]} aria-label={t(`prefs.${key}`)} className={cn("relative h-5 w-9 shrink-0 rounded-pill transition-colors", prefs[key] ? "bg-gold" : "bg-ink/15")}>
                  <span className={cn("absolute top-0.5 left-0.5 size-4 rounded-full bg-white shadow transition-transform", prefs[key] && "translate-x-4")} />
                </button>
              </form>
            ))}
            <p className="px-1 text-[11px] text-muted">{t("prefs.note")}</p>
          </div>
        </section>

      <section id="accounts" className="card scroll-mt-24 p-6">
        <div className="flex items-start gap-3">
          <Icon name="card" size={26} className="mt-0.5 shrink-0 text-gold" />
          <div>
            <h2 className="text-[20px] font-medium tracking-tight">{a("title")}</h2>
            <p className="text-[12px] text-muted">{a("subtitle", { hours: settings.bankCoolingHours })}</p>
          </div>
        </div>
        <div className="mt-4 flex flex-col gap-2">
          {accounts.length === 0 ? (
            <p className="px-1 text-[13px] text-muted">{a("empty")}</p>
          ) : (
            accounts.map((account) => {
              const cooling = Date.parse(account.usable_after) > now;
              return (
                <div key={account.id} className={row}>
                  <Icon name="card" size={20} className="shrink-0 text-gold" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13px] font-semibold">
                      {account.bank_name} •••• {account.last4}
                    </span>
                    <span className="block text-[12px] text-muted">
                      {account.holder_name} · {a(account.account_type === "SAVINGS" ? "savings" : "checking")}
                    </span>
                  </span>
                  {cooling && <span className="rounded-pill bg-status-limited/15 px-2.5 py-1 text-[11px] font-medium text-[#a87415]">{a("usableAfter", { date: formatDateTime(account.usable_after) })}</span>}
                  {verified && <RemoveAccountButton id={account.id} />}
                </div>
              );
            })
          )}
          <details className="group">
            <summary className={`${row} cursor-pointer list-none hover:bg-pearl`}>
              <Icon name="plus" size={20} className="shrink-0 text-gold" />
              <span className="min-w-0 flex-1 text-[13px] font-semibold">{a("addTitle")}</span>
              <Icon name="chevron" size={13} className="text-muted transition-transform group-open:rotate-90" />
            </summary>
            <div className="px-2 pt-4 pb-2">
              <StepUpGate verified={verified} email={session.email}>
                <BankAccountForm />
              </StepUpGate>
              <p className="mt-3 flex items-center gap-1.5 text-[11px] text-muted">
                <Icon name="lock" size={12} />
                {a("secure")}
              </p>
            </div>
          </details>
        </div>
      </section>
      </div>
    </>
  );
}
