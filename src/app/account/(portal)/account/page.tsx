import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { LocaleSwitch } from "@/components/ops/LocaleSwitch";
import { startCardSetup, togglePreference } from "@/features/portal/account-actions";
import { PasswordForm } from "@/features/portal/AuthForms";
import { Icon, type IconName } from "@/features/portal/icons";
import { readPreferences } from "@/features/portal/preferences";
import { listTrips } from "@/features/portal/queries";
import { QuickRequestForm } from "@/features/portal/RequestForms";
import { ProfileForm } from "@/features/portal/TripControls";
import { banners, IconBadge, PageIntro, whitePill } from "@/features/portal/ui";
import { openStatuses } from "@/features/reservations/types";
import { requireCustomer } from "@/lib/auth/customer";
import { createAdminClient } from "@/lib/supabase/admin";
import { cn } from "@/lib/utils/cn";
import { formatDay } from "@/lib/utils/format";

export const metadata: Metadata = { title: "Account" };

type Props = { searchParams: Promise<{ card?: string }> };

function Row({ icon, title, body, right, href, chevron = true }: { icon: IconName; title: string; body?: string; right: React.ReactNode; href?: string; chevron?: boolean }) {
  const inner = (
    <>
      <Icon name={icon} size={20} className="shrink-0 text-gold" />
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] font-semibold">{title}</span>
        {body && <span className="block text-[12px] text-muted">{body}</span>}
      </span>
      <span className="flex shrink-0 items-center gap-2 text-[12px] text-charcoal">
        {right}
        {chevron && <Icon name="chevron" size={14} className="text-muted" />}
      </span>
    </>
  );
  const className = "flex items-center gap-3 rounded-xl bg-[#f7f4ee] px-4 py-3";
  return href ? (
    <Link href={href} className={cn(className, "hover:bg-pearl")}>
      {inner}
    </Link>
  ) : (
    <div className={className}>{inner}</div>
  );
}

function Switch({ name, on, label }: { name: string; on: boolean; label: string }) {
  return (
    <form action={togglePreference} className="flex items-center gap-2">
      <input type="hidden" name="key" value={name} />
      <input type="hidden" name="value" value={on ? "0" : "1"} />
      <span className="text-[12px] text-charcoal">{label}</span>
      <button type="submit" role="switch" aria-checked={on} aria-label={label} className={cn("relative h-5 w-9 shrink-0 rounded-pill transition-colors", on ? "bg-gold" : "bg-ink/15")}>
        <span className={cn("absolute top-0.5 left-0.5 size-4 rounded-full bg-white shadow transition-transform", on && "translate-x-4")} />
      </button>
    </form>
  );
}

export default async function AccountPage({ searchParams }: Props) {
  const session = await requireCustomer();
  const { card } = await searchParams;
  const [t, brand, states, locale, trips, { data: customer }] = await Promise.all([
    getTranslations("portal.account"),
    getTranslations("portal.brand"),
    getTranslations("reservations.state"),
    getLocale(),
    listTrips(session.customerId),
    createAdminClient().from("customers").select("created_at, identity_status, identity_verified_at, license_expires_on, stripe_card_brand, stripe_card_last4, preferences").eq("id", session.customerId).maybeSingle(),
  ]);
  const nextTrip = trips.filter((trip) => openStatuses.includes(trip.status)).sort((a, b) => a.pickup_at.localeCompare(b.pickup_at))[0] ?? null;
  const identity = customer?.identity_status ?? "PENDING";
  const memberSince = customer?.created_at ? new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en-US", { year: "numeric" }).format(new Date(customer.created_at)) : "";
  const verifiedOn = customer?.identity_verified_at ? formatDay(customer.identity_verified_at, locale) : null;
  const hasCard = Boolean(customer?.stripe_card_brand && customer.stripe_card_last4);
  const prefs = readPreferences(customer?.preferences);

  return (
    <>
      <PageIntro title={t("title")} subtitle={t("subtitle")} tagline={[brand("t1"), brand("t2")]} />
      {card === "saved" && <p className="mb-4 rounded-xl bg-status-available/10 px-4 py-3 text-[13px]">{t("cardSaved")}</p>}
      {card === "unavailable" && <p className="mb-4 rounded-xl bg-status-danger/8 px-4 py-3 text-[13px] text-status-danger">{t("cardUnavailable")}</p>}

      <section className="card relative overflow-hidden">
        <div className="absolute inset-y-0 right-0 hidden w-[58%] sm:block">
          <Image src={banners.front} alt="" fill priority sizes="40rem" className="object-cover object-[70%_center]" />
          <div className="absolute inset-0 bg-gradient-to-r from-white via-white/85 via-35% to-transparent" />
        </div>
        <div className="relative flex flex-wrap items-center gap-6 p-6 sm:p-8">
          <span className="relative flex size-24 items-center justify-center rounded-full bg-gold text-3xl font-medium text-white">
            {session.fullName.trim().slice(0, 1).toUpperCase()}
            <span className="absolute right-0 bottom-0 flex size-8 items-center justify-center rounded-full bg-gold-light text-white ring-2 ring-white">
              <Icon name="camera" size={14} />
            </span>
          </span>
          <div className="min-w-0">
            <p className="text-[1.8rem] leading-tight font-medium tracking-tight">{session.fullName}</p>
            {memberSince && <p className="text-[14px] text-muted">{t("memberSince", { date: memberSince })}</p>}
            <p className="mt-3 flex items-center gap-2.5 text-[14px] text-charcoal">
              <Icon name="mail" size={16} className="text-gold" />
              {session.email}
            </p>
            {session.phone && (
              <p className="mt-1.5 flex items-center gap-2.5 text-[14px] text-charcoal">
                <Icon name="phone" size={16} className="text-gold" />
                {session.phone}
              </p>
            )}
          </div>
          <a href="#profile" className={`${whitePill} ml-auto`}>
            <Icon name="pencil" size={14} />
            {t("editProfile")}
          </a>
        </div>
      </section>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <section className="card p-6">
          <div className="flex items-start gap-3">
            <Icon name="shield" size={26} className="mt-0.5 shrink-0 text-gold" />
            <div>
              <h2 className="text-[20px] font-medium tracking-tight">{t("verification")}</h2>
              <p className="text-[12px] text-muted">{t("verificationBody")}</p>
            </div>
          </div>
          <div className="mt-4">
            <Row
              icon="idcard"
              title={t("license")}
              body={verifiedOn ? t("verifiedOn", { date: verifiedOn }) : customer?.license_expires_on ? `→ ${customer.license_expires_on}` : t("notVerified")}
              right={<span className={cn("rounded-pill px-2.5 py-1 text-[11px] font-medium", identity === "VERIFIED" ? "bg-status-available/12 text-status-available" : identity === "REJECTED" ? "bg-status-danger/10 text-status-danger" : "bg-pearl text-charcoal")}>{states(identity)}</span>}
              href={nextTrip ? `/trips/${nextTrip.number}` : undefined}
            />
          </div>
          <Link href={nextTrip ? `/trips/${nextTrip.number}` : "/trips"} className={`${whitePill} mt-4 w-full`}>
            <Icon name="upload" size={15} />
            {identity === "VERIFIED" ? t("updateDocs") : t("verifyNow")}
          </Link>
        </section>

        <section className="card p-6">
          <div className="flex items-start gap-3">
            <Icon name="card" size={26} className="mt-0.5 shrink-0 text-gold" />
            <div>
              <h2 className="text-[20px] font-medium tracking-tight">{t("payment")}</h2>
              <p className="text-[12px] text-muted">{t("paymentBody")}</p>
            </div>
          </div>
          <div className="mt-4">
            <Row
              icon="card"
              title={hasCard ? `${customer?.stripe_card_brand?.toUpperCase()} •••• ${customer?.stripe_card_last4}` : t("noCard")}
              right={hasCard ? <span className="rounded-pill bg-gold/12 px-2.5 py-1 text-[11px] font-medium text-ink">{t("primary")}</span> : null}
            />
          </div>
          <form action={startCardSetup} className="mt-4">
            <button type="submit" className={`${whitePill} w-full`}>
              <Icon name="plus" size={15} />
              {hasCard ? t("changeCard") : t("addCard")}
            </button>
          </form>
          <p className="mt-3 flex items-center gap-1.5 text-[11px] text-muted">
            <Icon name="lock" size={12} />
            {t("secure")}
          </p>
        </section>

        <section className="card p-6">
          <div className="flex items-start gap-3">
            <Icon name="compass" size={26} className="mt-0.5 shrink-0 text-gold" />
            <div>
              <h2 className="text-[20px] font-medium tracking-tight">{t("preferences")}</h2>
              <p className="text-[12px] text-muted">{t("preferencesBody")}</p>
            </div>
          </div>
          <div className="mt-4 flex flex-col gap-2">
            <Row icon="globe" title={t("language")} body={t("languageBody")} right={<LocaleSwitch label={t("switchLanguage")} className="border border-gold/40 bg-white text-ink hover:border-gold" />} chevron={false} />
            <Row icon="bell" title={t("notifications")} body={t("notificationsBody")} right={<Switch name="notifications" on={prefs.notifications} label={prefs.notifications ? t("enabled") : t("disabled")} />} chevron={false} />
            <Row
              icon="mail"
              title={t("communication")}
              body={t("communicationBody")}
              right={
                <span className="flex flex-wrap items-center justify-end gap-x-4 gap-y-1">
                  <Switch name="updates" on={prefs.updates} label={t("commUpdates")} />
                  <Switch name="offers" on={prefs.offers} label={t("commOffers")} />
                </span>
              }
              chevron={false}
            />
          </div>
        </section>

        <section className="card p-6">
          <div className="flex items-start gap-3">
            <Icon name="lock" size={26} className="mt-0.5 shrink-0 text-gold" />
            <div>
              <h2 className="text-[20px] font-medium tracking-tight">{t("security")}</h2>
              <p className="text-[12px] text-muted">{t("securityBody")}</p>
            </div>
          </div>
          <div className="mt-4 flex flex-col gap-2">
            <details className="group">
              <summary className="flex cursor-pointer list-none items-center gap-3 rounded-xl bg-[#f7f4ee] px-4 py-3 hover:bg-pearl">
                <Icon name="key" size={20} className="shrink-0 text-gold" />
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] font-semibold">{t("password")}</span>
                  <span className="block text-[12px] text-muted">{t("passwordBody")}</span>
                </span>
                <span className={`${whitePill} h-8 px-3 text-[12px]`}>
                  {t("changePassword")}
                  <Icon name="chevron" size={13} className="transition-transform group-open:rotate-90" />
                </span>
              </summary>
              <div className="px-2 pt-4 pb-2">
                <PasswordForm />
              </div>
            </details>
            <Row icon="shield" title={t("twoFactor")} body={t("twoFactorBody")} right={<span className="text-muted">{t("notEnabled")}</span>} />
            <Row icon="clock" title={t("signInActivity")} body={t("signInActivityBody")} right={null} />
          </div>
        </section>
      </div>

      <section id="profile" className="card mt-4 hidden p-6 target:block sm:p-7">
        <h2 className="mb-4 text-[17px] font-semibold tracking-tight">{t("profile")}</h2>
        <ProfileForm profile={{ fullName: session.fullName, phone: session.phone, wechat: session.wechat, dateOfBirth: session.dateOfBirth, address: session.address, language: session.language, email: session.email }} />
      </section>

      <section className="card mt-4 flex flex-wrap items-center gap-4 p-5">
        <IconBadge name="x" size={10} className="bg-status-danger/10 text-status-danger" />
        <div className="min-w-0 flex-1">
          <h2 className="text-[15px] font-semibold">{t("deleteTitle")}</h2>
          <p className="text-[12px] text-muted">{t("deleteBody")}</p>
        </div>
        <QuickRequestForm type="other" message={t("deleteMessage")} label={t("deleteRequest")} />
      </section>
    </>
  );
}
