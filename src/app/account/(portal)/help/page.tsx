import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { AskMoviaButton } from "@/features/portal/AskMovia";
import { loadPortalContent, pick } from "@/features/portal/content";
import { faq, guides } from "@/features/portal/guides";
import { Icon, type IconName } from "@/features/portal/icons";
import { listRecommendations, type Recommendation } from "@/features/portal/recommendations";
import { siteLink } from "@/features/portal/site";
import { banners, goldPill, IconBadge, PageIntro, SectionHeading, whitePill } from "@/features/portal/ui";
import { requireCustomer } from "@/lib/auth/customer";

export const metadata: Metadata = { title: "Help Center" };

type Props = { searchParams: Promise<{ q?: string }> };

export default async function HelpPage({ searchParams }: Props) {
  await requireCustomer();
  const { q } = await searchParams;
  const [t, brand, cats, locale, content] = await Promise.all([getTranslations("portal.help"), getTranslations("portal.brand"), getTranslations("portal.blogCategories"), getLocale(), loadPortalContent()]);
  const term = (q ?? "").trim().toLowerCase();
  const terms = term === "fsd" ? [term, "full self-driving"] : [term];
  const matches = (...values: string[]) => !term || values.some((value) => terms.some((needle) => value.toLowerCase().includes(needle)));
  const label = (category: string) => (cats.has(category) ? cats(category) : category);
  const visibleGuides: Recommendation[] = term
    ? guides.filter((guide) => matches(guide.title.zh, guide.title.en, guide.summary.zh, guide.summary.en)).map((guide) => ({ key: guide.slug, title: pick(guide.title, locale), summary: pick(guide.summary, locale), category: null, href: `/help/guides/${guide.slug}`, image: guide.image, external: false }))
    : await listRecommendations("booked", locale, 4, label);
  const matchedFaq = faq.filter((item) => matches(item.q.zh, item.q.en, item.a.zh, item.a.en));
  const visibleFaq = term ? matchedFaq : matchedFaq.slice(0, 6);
  const zh = locale === "zh";
  const topics = ["FSD", zh ? "充电" : "Charging", zh ? "取车" : "Pickup", zh ? "还车" : "Return", zh ? "费用" : "Billing"];
  const hours = pick(content.contact.hours, locale);
  const cards: Array<{ icon: IconName; title: string; body: string; detail: string; action: "ask" | "chat" | "report" }> = [
    { icon: "sparkle", title: t("askTitle"), body: t("askBody"), detail: t("askDetail"), action: "ask" },
    { icon: "headset", title: t("human"), body: t("humanBody"), detail: hours || t("humanDetail"), action: "chat" },
    { icon: "alert", title: t("reportTitle"), body: t("reportBody"), detail: t("reportDetail"), action: "report" },
  ];
  const channels = [
    { icon: "phone" as IconName, label: t("phone"), value: content.contact.phone, note: t("phoneNote"), href: content.contact.phone ? `tel:${content.contact.phone.replace(/[^+\d]/g, "")}` : undefined },
    { icon: "mail" as IconName, label: t("email"), value: content.contact.email, note: t("emailNote"), href: content.contact.email ? `mailto:${content.contact.email}` : undefined },
    { icon: "chat" as IconName, label: t("wechat"), value: content.contact.wechat, note: t("wechatNote") },
  ].filter((item) => item.value);

  return (
    <>
      <PageIntro title={t("title")} subtitle={t("subtitle")} tagline={[brand("t1"), brand("t2")]} />

      <section className="relative overflow-hidden rounded-[var(--radius-card)] bg-ink text-white">
        <Image src={content.banners.help || banners.interior} alt="" fill unoptimized={Boolean(content.banners.help)} sizes="(min-width: 1024px) 64rem, 100vw" className="object-cover" priority />
        <div className="absolute inset-0 bg-gradient-to-r from-ink/85 via-ink/45 to-ink/10" />
        <div className="relative flex min-h-[15rem] flex-col justify-center p-6 sm:p-9">
          <p className="text-[10px] tracking-[0.28em] text-white/85 uppercase">{t("heroEyebrow")}</p>
          <h2 className="mt-3 text-[2.2rem] leading-tight font-light tracking-tight">{t("heroTitle")}</h2>
          <form action="/help" className="mt-4 flex max-w-xl rounded-pill bg-white p-1">
            <label className="flex min-w-0 flex-1 items-center gap-2 px-4 text-muted">
              <Icon name="search" size={16} />
              <input name="q" defaultValue={q ?? ""} placeholder={t("searchPlaceholder")} className="h-10 min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-muted/70" />
            </label>
            <button type="submit" className="h-10 shrink-0 rounded-pill bg-gold px-5 text-sm font-medium text-white hover:bg-gold-light">
              {t("search")}
            </button>
          </form>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-[12px]">
            <span className="text-white/80">{t("popular")}</span>
            {topics.map((topic) => (
              <Link key={topic} href={`/help?q=${encodeURIComponent(topic)}`} className="rounded-pill bg-white/15 px-3 py-1 text-white backdrop-blur hover:bg-white/25">
                {topic}
              </Link>
            ))}
          </div>
        </div>
      </section>

      <div className="mt-4 grid gap-4 md:grid-cols-3">
        {cards.map((card) => (
          <section key={card.action} className="card flex flex-col p-5">
            <div className="flex items-start gap-3">
              <IconBadge name={card.icon} size={10} />
              <div>
                <h2 className="text-[16px] font-semibold">{card.title}</h2>
                <p className="text-[13px] text-charcoal">{card.body}</p>
              </div>
            </div>
            <p className="mt-2 flex-1 pl-[3.25rem] text-[12px] text-muted">{card.detail}</p>
            <div className="mt-4">
              {card.action === "ask" ? (
                <AskMoviaButton className={`${goldPill} w-full`}>
                  {t("ask")}
                  <Icon name="arrow" size={14} />
                </AskMoviaButton>
              ) : (
                <Link href={card.action === "chat" ? "/messages?type=other" : "/messages?type=issue"} className={`${whitePill} w-full`}>
                  <Icon name={card.action === "chat" ? "chat" : "doc"} size={15} />
                  {card.action === "chat" ? t("startChat") : t("report")}
                </Link>
              )}
            </div>
          </section>
        ))}
      </div>

      <section className="card mt-4 p-6">
        <SectionHeading title={t("guides")} subtitle={t("guidesBody")} href={siteLink(locale, "/blog")} more={t("allGuides")} />
        {visibleGuides.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-muted">{t("noResults")}</p>
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {visibleGuides.map((guide) => {
              const inner = (
                <>
                  <span className="relative block aspect-[16/10] w-full overflow-hidden bg-pearl">
                    <Image src={guide.image} alt="" fill unoptimized={guide.external} sizes="18rem" className="object-cover" />
                  </span>
                  <span className="flex items-start gap-2 p-3.5">
                    <span className="min-w-0 flex-1">
                      <span className="line-clamp-2 text-[13px] leading-snug font-semibold">{guide.title}</span>
                      {guide.summary && <span className="mt-0.5 block truncate text-[12px] leading-snug text-muted">{guide.summary}</span>}
                    </span>
                    <Icon name="chevron" size={14} className="mt-0.5 shrink-0 text-muted" />
                  </span>
                </>
              );
              const className = "block overflow-hidden rounded-xl bg-[#f7f4ee] transition-shadow hover:shadow-lift";
              return (
                <li key={guide.key}>
                  {guide.external ? (
                    <a href={guide.href} target="_blank" rel="noreferrer" className={className}>
                      {inner}
                    </a>
                  ) : (
                    <Link href={guide.href} className={className}>
                      {inner}
                    </Link>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)]">
        <section id="faq" className="card p-6">
          <h2 className="text-[17px] font-semibold tracking-tight">{t("faq")}</h2>
          {visibleFaq.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted">{t("noResults")}</p>
          ) : (
            <div className="mt-2 divide-y divide-ink/[0.06]">
              {visibleFaq.map((item) => (
                <details key={item.id} className="group py-3">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-[14px] font-medium">
                    {pick(item.q, locale)}
                    <Icon name="chevron" size={14} className="shrink-0 rotate-90 text-muted transition-transform group-open:-rotate-90" />
                  </summary>
                  <p className="mt-2 text-[13px] leading-relaxed text-charcoal">{pick(item.a, locale)}</p>
                </details>
              ))}
            </div>
          )}
          <a href={siteLink(locale, "/faq")} target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-1 text-[13px] font-medium text-gold hover:text-gold-light">
            {t("allFaq")}
            <Icon name="arrow" size={14} />
          </a>
        </section>
        <div className="flex flex-col gap-4">
          <section className="card flex flex-wrap items-center gap-4 border-status-danger/20 bg-[#fdf3f2] p-5">
            <IconBadge name="alert" size={10} className="bg-status-danger/10 text-status-danger" />
            <div className="min-w-0 flex-1">
              <h2 className="text-[16px] font-semibold">{t("roadside")}</h2>
              <p className="text-[12px] leading-relaxed text-charcoal">{t("roadsideBody")}</p>
            </div>
            {content.contact.phone && (
              <a href={`tel:${content.contact.phone.replace(/[^+\d]/g, "")}`} className="inline-flex h-11 flex-col items-center justify-center rounded-pill bg-status-danger px-5 text-white hover:opacity-90">
                <span className="flex items-center gap-1.5 text-[13px] font-medium">
                  <Icon name="phone" size={14} />
                  {t("callNow")}
                </span>
                <span className="text-[10px] tracking-wide text-white/85">{content.contact.phone}</span>
              </a>
            )}
          </section>
          <section className="card p-5">
            <div className="flex items-start gap-3">
              <IconBadge name="mail" size={10} />
              <div>
                <h2 className="text-[16px] font-semibold">{t("stillHelp")}</h2>
                <p className="text-[12px] text-muted">{t("stillHelpBody")}</p>
              </div>
            </div>
            <ul className="mt-4 flex flex-col divide-y divide-ink/[0.06]">
              {channels.map((item) => (
                <li key={item.label} className="flex items-center gap-3 py-2.5">
                  <Icon name={item.icon} size={16} className="shrink-0 text-gold" />
                  <span className="w-14 shrink-0 text-[12px] text-muted">{item.label}</span>
                  {item.href ? (
                    <a href={item.href} className="min-w-0 flex-1 truncate text-[13px] font-semibold hover:text-gold">
                      {item.value}
                    </a>
                  ) : (
                    <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">{item.value}</span>
                  )}
                  <span className="hidden shrink-0 text-[11px] text-muted sm:block">{item.note}</span>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>
    </>
  );
}
