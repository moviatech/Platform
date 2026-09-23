import type { Metadata } from "next";
import Image from "next/image";
import { getLocale, getTranslations } from "next-intl/server";
import { ensureReferralCode, loadPortalContent, pick } from "@/features/portal/content";
import { Icon } from "@/features/portal/icons";
import { CopyButton } from "@/features/portal/RequestForms";
import { bannerThumbs, banners, PageIntro, SectionHeading, StatCard, whitePill } from "@/features/portal/ui";
import { requireCustomer } from "@/lib/auth/customer";

export const metadata: Metadata = { title: "Rewards" };

export default async function RewardsPage() {
  const session = await requireCustomer();
  const [t, brand, locale, content, code] = await Promise.all([getTranslations("portal.offers"), getTranslations("portal.brand"), getLocale(), loadPortalContent(), ensureReferralCode(session.customerId)]);
  const shareText = t("shareText", { code });
  const thumbs = [bannerThumbs.home, bannerThumbs.interior, bannerThumbs.front];

  return (
    <>
      <PageIntro title={t("title")} subtitle={t("subtitle")} tagline={[brand("t1"), brand("t2")]} />

      <section className="card grid overflow-hidden lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
        <div className="relative min-h-[17rem]">
          <Image src={content.banners.rewards || banners.home} alt="" fill unoptimized={Boolean(content.banners.rewards)} priority sizes="(min-width: 1024px) 44rem, 100vw" className="object-cover object-[65%_center]" />
          <div className="absolute inset-0 bg-gradient-to-r from-ink/75 via-ink/30 to-transparent" />
          <div className="absolute inset-0 flex flex-col justify-center p-6 text-white sm:p-9">
            <p className="mb-3 text-[10px] tracking-[0.28em] text-white/85 uppercase">{brand("share1")} {brand("share2")}</p>
            <h2 className="max-w-[10ch] text-[2.4rem] leading-[1.05] font-light tracking-tight">{t("heroTitle")}</h2>
            <p className="mt-3 max-w-sm text-[13px] leading-relaxed text-white/85">{t("heroBody")}</p>
          </div>
        </div>
        <div className="flex flex-col justify-center gap-3 p-6 sm:p-7">
          <p className="text-[11px] tracking-[0.24em] text-gold uppercase">{t("yourCode")}</p>
          <p className="flex items-center justify-between rounded-xl bg-pearl px-5 py-4 font-mono text-[1.6rem] tracking-[0.22em] text-ink">
            {code || "—"}
            <Icon name="doc" size={18} className="text-muted" />
          </p>
          <div className="flex flex-wrap gap-2">
            <CopyButton value={code} label={t("copyCode")} copied={t("copied")} variant="gold" />
            <CopyButton value={shareText} label={t("share")} copied={t("copied")} />
          </div>
          <p className="flex gap-2 rounded-xl bg-gold/8 px-4 py-3 text-[12px] leading-relaxed text-charcoal">
            <Icon name="alert" size={14} className="mt-0.5 shrink-0 text-gold" />
            {pick(content.referral.body, locale) || t("rollingOut")}
          </p>
        </div>
      </section>

      <div className="mt-5 grid gap-4 md:grid-cols-3">
        <StatCard icon="gift" label={t("stats.offers")} value={content.announcements.length} body={t("stats.offersBody")} href="#offers" more={t("stats.viewOffers")} />
        <StatCard icon="users" label={t("stats.referral")} value={0} body={t("stats.referralBody")} href="#activity" more={t("stats.viewActivity")} />
        <StatCard icon="coins" label={t("stats.credits")} value="—" body={t("stats.creditsBody")} href="#activity" more={t("stats.viewDetails")} />
      </div>

      <section id="offers" className="mt-8">
        <SectionHeading title={t("exclusive")} subtitle={t("exclusiveBody")} href="#offers" more={t("viewAllOffers")} />
        {content.announcements.length === 0 ? (
          <p className="card px-5 py-8 text-center text-sm text-muted">{t("noAnnouncements")}</p>
        ) : (
          <ul className="grid gap-4 md:grid-cols-2">
            {content.announcements.map((item, index) => (
              <li key={index} className="card grid overflow-hidden sm:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
                <div className="relative min-h-[10rem]">
                  <Image src={thumbs[index % thumbs.length]} alt="" fill sizes="18rem" className="object-cover" />
                </div>
                <div className="p-5">
                  <p className="text-[10px] tracking-[0.24em] text-gold uppercase">{t("forFriends")}</p>
                  <p className="mt-2 text-[17px] leading-tight font-semibold">{pick(item.title, locale)}</p>
                  <p className="mt-1.5 text-[13px] text-charcoal">{pick(item.body, locale)}</p>
                  {item.url && (
                    <a href={item.url} target="_blank" rel="noreferrer" className={`${whitePill} mt-4 h-9 px-3.5 text-[12px]`}>
                      {t("learnMore")}
                    </a>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section id="activity" className="mt-8">
        <SectionHeading title={t("activity")} subtitle={t("activityBody")} />
        <div className="card overflow-hidden">
          <div className="grid grid-cols-5 gap-3 border-b border-ink/[0.06] px-5 py-3 text-[10px] tracking-[0.18em] text-muted uppercase">
            <span>{t("table.date")}</span>
            <span>{t("table.friend")}</span>
            <span>{t("table.activity")}</span>
            <span>{t("table.status")}</span>
            <span className="text-right">{t("table.credits")}</span>
          </div>
          <p className="px-5 py-8 text-center text-sm text-muted">{t("noActivity")}</p>
        </div>
      </section>
    </>
  );
}
