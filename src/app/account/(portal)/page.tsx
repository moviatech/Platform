import { existsSync } from "node:fs";
import path from "node:path";
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { listClasses } from "@/features/booking/service";
import { currentTime } from "@/features/booking/time";
import { AskMoviaButton } from "@/features/portal/AskMovia";
import { listChangeRequests, pendingChangeStatuses } from "@/features/portal/change-queries";
import { loadPortalContent, pick } from "@/features/portal/content";
import { tripDate } from "@/features/portal/dates";
import { Dismissible } from "@/features/portal/Dismissible";
import { classImage, listVehicleMedia } from "@/features/portal/garage";
import { Icon } from "@/features/portal/icons";
import { listTripPayments, listTrips } from "@/features/portal/queries";
import { listRecommendations } from "@/features/portal/recommendations";
import { siteLink } from "@/features/portal/site";
import { bannerThumbs, banners, DetailRow, ghostPill, goldPill, IconBadge, PageIntro, RecoGrid, SectionHeading, VehicleVisual, whitePill } from "@/features/portal/ui";
import { openStatuses } from "@/features/reservations/types";
import { requireCustomer } from "@/lib/auth/customer";
import { createAdminClient } from "@/lib/supabase/admin";
import { cn } from "@/lib/utils/cn";
import { formatDay } from "@/lib/utils/format";

export const metadata: Metadata = { title: "Dashboard" };

export default async function HomePage() {
  const session = await requireCustomer();
  const meetBackground = existsSync(path.join(process.cwd(), "public", "portal", "banners", "meet-bg.webp")) ? "/portal/banners/meet-bg.webp" : null;
  const [t, brand, statuses, cats, locale, trips, content] = await Promise.all([
    getTranslations("portal.home"),
    getTranslations("portal.brand"),
    getTranslations("reservations.status"),
    getTranslations("portal.blogCategories"),
    getLocale(),
    listTrips(session.customerId),
    loadPortalContent(),
  ]);
  const zh = locale === "zh";
  const now = currentTime();
  const label = (category: string) => (cats.has(category) ? cats(category) : category);
  const open = trips.filter((trip) => openStatuses.includes(trip.status)).sort((a, b) => a.pickup_at.localeCompare(b.pickup_at));
  const next = open.find((trip) => trip.status === "ACTIVE") ?? open.find((trip) => new Date(trip.return_at).getTime() >= now) ?? open[0] ?? null;
  const lastPast = trips.filter((trip) => trip.status === "COMPLETED").sort((a, b) => b.return_at.localeCompare(a.return_at))[0] ?? null;
  const [media, payments, card, requests, classes, recs] = await Promise.all([
    listVehicleMedia(next?.assigned_vehicle_id ? [next.assigned_vehicle_id] : []),
    next ? listTripPayments(session.customerId, next.id) : Promise.resolve([]),
    createAdminClient().from("customers").select("stripe_payment_method_id").eq("id", session.customerId).maybeSingle(),
    next ? listChangeRequests(next.id, session.customerId) : Promise.resolve([]),
    next ? Promise.resolve([]) : listClasses(),
    listRecommendations(next ? "booked" : "browsing", locale, 3, label),
  ]);
  const items = next?.assigned_vehicle_id ? (media[next.assigned_vehicle_id] ?? []) : [];
  const cover = items.find((item) => item.kind === "IMAGE")?.url ?? null;
  const hasVideo = items.some((item) => item.kind === "VIDEO");
  const name = (trip: (typeof trips)[number]) => (zh ? (trip.vehicle_class?.name_zh ?? trip.vehicle_class?.name) : trip.vehicle_class?.name) ?? "";
  const firstName = session.fullName.trim().split(/\s+/)[0] || session.fullName;
  const teslaGuide = recs.find((item) => item.category === "tips" || item.category === "fsd");

  const paid = ["PAID", "PARTIALLY_REFUNDED"].includes(next?.payment_state ?? "");
  const paymentDone = next ? (next.rate_plan === "PAY_NOW" ? paid : paid || Boolean(card.data?.stripe_payment_method_id) || payments.some((payment) => payment.status === "SUCCEEDED")) : false;
  const licenseDone = next?.verification_state === "VERIFIED";
  const agreementDone = next?.agreement_state === "SIGNED";
  const checklist = next
    ? [
        { label: t("check.license"), done: licenseDone, href: `/trips/${next.number}` },
        { label: t("check.agreement"), done: agreementDone, href: `/trips/${next.number}/agreement` },
        { label: t("check.payment"), done: paymentDone, href: `/trips/${next.number}` },
        { label: t("check.pickup"), done: licenseDone && agreementDone && paymentDone, href: `/vehicle?trip=${next.number}` },
      ]
    : [];
  const doneCount = checklist.filter((item) => item.done).length;
  const pendingRequests = requests.filter((request) => pendingChangeStatuses.includes(request.status)).length;
  const stageSubtitle = !next ? (lastPast ? t("subtitleReturning") : t("subtitleNew")) : next.status === "ACTIVE" ? t("subtitleActive") : ["REQUESTED", "PENDING_PAYMENT"].includes(next.status) ? t("subtitlePending") : t("subtitleUpcoming");
  const featured = ["model-y-basic", "model-y-premium", "cybertruck-premium"].map((slug) => classes.find((item) => item.slug === slug)).filter((item): item is NonNullable<typeof item> => Boolean(item));
  const pickup = next ? tripDate(next.pickup_at, locale) : null;
  const dropoff = next ? tripDate(next.return_at, locale) : null;
  const locationName = next ? (next.pickup_method === "DELIVERY" && next.delivery_address ? next.delivery_address : ((zh ? (next.location?.name_zh ?? next.location?.name) : next.location?.name) ?? "")) : "";

  return (
    <>
      <PageIntro title={t("welcome", { name: firstName })} subtitle={stageSubtitle} tagline={[brand("t1"), brand("t2")]} />

      {next ? (
        <section className="card grid overflow-hidden lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
          <div className="relative min-h-[17rem] lg:min-h-full">
            <Image src={cover || content.banners.home || banners.home} alt="" fill unoptimized={Boolean(cover || content.banners.home)} priority sizes="(min-width: 1024px) 34rem, 100vw" className="object-cover object-[60%_center]" />
            <div className="absolute inset-0 bg-gradient-to-t from-ink/70 via-ink/15 to-ink/10" />
            <div className="absolute inset-0 flex flex-col justify-between p-6 text-white sm:p-7">
              <p className="text-[10px] tracking-[0.28em] text-white/85 uppercase">{next.status === "ACTIVE" ? t("activeTrip") : t("upcomingTrip")}</p>
              <p className="max-w-[9ch] text-[2.5rem] leading-[1.05] font-light tracking-tight">{brand("journeys")}</p>
            </div>
          </div>
          <div className="flex flex-col gap-5 p-6 sm:p-7">
            <h2 className="text-[1.7rem] leading-tight font-medium tracking-tight">{name(next)}</h2>
            <div className="grid grid-cols-2 gap-x-4 gap-y-4 xl:grid-cols-4 xl:divide-x xl:divide-ink/[0.08] xl:[&>*]:px-3 xl:[&>*:first-child]:pl-0">
              <DetailRow icon="calendar" label={t("pickup")} value={pickup?.date} sub={pickup?.time} />
              <DetailRow icon="calendar" label={t("return")} value={dropoff?.date} sub={dropoff?.time} />
              <DetailRow icon="pin" label={t("location")} value={locationName} />
              <DetailRow icon="check" label={t("status")} value={statuses(next.status)} tone="gold" />
            </div>
            <div className="flex flex-wrap gap-2">
              <Link href={`/trips/${next.number}`} className={goldPill}>
                {t("viewTrip")}
                <Icon name="arrow" size={14} />
              </Link>
              <Link href={`/trips/${next.number}/modify`} className={whitePill}>
                {t("modify")}
                {pendingRequests > 0 ? ` · ${pendingRequests}` : ""}
              </Link>
              <Link href={`/messages?trip=${next.number}`} className={whitePill}>
                <Icon name="headset" size={15} />
                {t("getHelp")}
              </Link>
            </div>
            {next.status !== "ACTIVE" && (
              <div className="border-t border-ink/[0.06] pt-4">
                <div className="flex items-center justify-between gap-3 text-[13px]">
                  <span className="font-semibold">{t("checklist")}</span>
                  <span className="flex items-center gap-2 text-muted">
                    {t("checklistProgress", { done: doneCount, total: checklist.length })}
                    <span className="h-1.5 w-28 overflow-hidden rounded-pill bg-pearl">
                      <span className="block h-full rounded-pill bg-gold" style={{ width: `${(doneCount / checklist.length) * 100}%` }} />
                    </span>
                  </span>
                </div>
                <ul className="mt-3 grid grid-cols-2 gap-3 xl:grid-cols-4">
                  {checklist.map((item) => (
                    <li key={item.label}>
                      <Link href={item.href} className="flex items-start gap-2 text-[12px] leading-snug hover:text-gold">
                        <span className={cn("mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full", item.done ? "bg-gold text-white" : "border border-ink/20")}>{item.done && <Icon name="check" size={11} />}</span>
                        <span className={item.done ? "text-charcoal" : "text-ink"}>{item.label}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </section>
      ) : (
        <section className="relative overflow-hidden rounded-[var(--radius-card)] bg-ink text-white">
          <Image src={content.banners.home || banners.front} alt="" fill unoptimized={Boolean(content.banners.home)} priority sizes="(min-width: 1024px) 64rem, 100vw" className="object-cover" />
          <div className="absolute inset-0 bg-gradient-to-r from-ink/80 via-ink/35 to-transparent" />
          <div className="relative flex min-h-[20rem] flex-col justify-center p-6 sm:p-9">
            <p className="text-[10px] tracking-[0.28em] text-white/85 uppercase">{t("exploreEyebrow")}</p>
            <h2 className="mt-4 max-w-xl text-[2.6rem] leading-[1.05] font-light tracking-tight">{t("bookTitle")}</h2>
            <p className="mt-3 max-w-md text-[15px] text-white/85">{lastPast ? t("bookBodyReturning") : t("bookBody")}</p>
            <div className="mt-6 flex flex-wrap gap-2">
              <a href={siteLink(locale, "/book")} className={goldPill}>
                {t("bookCta")}
                <Icon name="arrow" size={14} />
              </a>
              <a href={siteLink(locale, "/vehicles")} className={ghostPill}>
                <Icon name="car" size={15} />
                {t("exploreCta")}
              </a>
            </div>
          </div>
        </section>
      )}

      {next ? (
        <section className="card relative mt-4 grid overflow-hidden bg-[#f4f1ea] lg:grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)]">
          {meetBackground && <Image src={meetBackground} alt="" fill priority sizes="100vw" className="object-cover" />}
          <div className="relative flex flex-col justify-center p-6 sm:p-9">
            <h2 className="text-[2rem] leading-tight font-medium tracking-tight">{t("meetTitle")}</h2>
            <p className="mt-1.5 text-[14px] text-muted">{t("meetBody")}</p>
            <div className="mt-5 flex flex-wrap gap-2">
              <Link href={`/vehicle?trip=${next.number}`} className={whitePill}>
                <Icon name="image" size={15} />
                {t("viewGallery")}
              </Link>
              {hasVideo ? (
                <Link href={`/vehicle?trip=${next.number}#videos`} className={whitePill}>
                  <Icon name="play" size={15} />
                  {t("watchPreview")}
                </Link>
              ) : (
                <span className={cn(whitePill, "cursor-default border-ink/10 text-muted")}>
                  <Icon name="play" size={15} />
                  {t("previewSoon")}
                </span>
              )}
            </div>
          </div>
          <div className="relative min-h-[15rem]">
            {cover ? (
              <Image src={cover} alt="" fill unoptimized sizes="(min-width: 1024px) 40rem, 100vw" className="object-cover" />
            ) : (
              <Image src={classImage(next.vehicle_class?.slug)} alt="" fill sizes="(min-width: 1024px) 40rem, 100vw" className="object-contain object-bottom p-4 pb-0" />
            )}
          </div>
        </section>
      ) : (
        featured.length > 0 && (
          <section className="card mt-4 p-6">
            <SectionHeading title={t("findFit")} subtitle={t("findFitBody")} href={siteLink(locale, "/vehicles/compare")} more={t("compare")} />
            <ul className="grid gap-4 md:grid-cols-3">
              {featured.map((item) => (
                <li key={item.slug}>
                  <a href={siteLink(locale, `/vehicles/${item.slug}`)} className="flex items-center gap-4 rounded-xl bg-[#f7f4ee] p-3 transition-shadow hover:shadow-lift">
                    <VehicleVisual slug={item.slug} className="aspect-[4/3] w-2/5 shrink-0 rounded-lg" sizes="12rem" />
                    <span className="min-w-0">
                      <span className="block text-[15px] font-semibold">{zh ? (item.name_zh ?? item.name) : item.name}</span>
                      <span className="mt-0.5 block text-[12px] text-muted">{t.has(`fit.${item.slug}`) ? t(`fit.${item.slug}`) : ""}</span>
                      <span className="mt-2 flex items-center gap-1 text-[13px] font-medium text-gold">
                        {t("viewDetails")}
                        <Icon name="arrow" size={14} />
                      </span>
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          </section>
        )
      )}

      <div className="mt-4 grid gap-4 md:grid-cols-3">
        {next ? (
          <section className="card flex flex-col p-5">
            <SectionHeading icon="luggage" title={t("specialTitle")} subtitle={t("specialBody")} />
            <div className="relative min-h-32 flex-1 overflow-hidden rounded-xl bg-pearl">
              <Image src={bannerThumbs.interior} alt="" fill sizes="20rem" className="object-cover" />
            </div>
            <Link href={`/trips/${next.number}/modify?action=special`} className={`${goldPill} mt-4 self-start`}>
              {t("requestSomething")}
              <Icon name="arrow" size={14} />
            </Link>
          </section>
        ) : (
          <section className="card flex flex-col p-5">
            <SectionHeading icon="gift" title={t("offersTitle")} subtitle={t("offersBody")} />
            <div className="relative overflow-hidden rounded-xl">
              <Image src={bannerThumbs.interior} alt="" width={640} height={320} className="aspect-[16/7] w-full object-cover" />
              <div className="absolute inset-0 bg-gradient-to-r from-ink/75 to-transparent" />
              <div className="absolute inset-0 flex flex-col justify-center p-5 text-white">
                <p className="text-[16px] leading-tight font-semibold">{content.announcements[0] ? pick(content.announcements[0].title, locale) : t("offerCardTitle")}</p>
                <p className="mt-1 max-w-[16rem] text-[12px] text-white/85">{content.announcements[0] ? pick(content.announcements[0].body, locale) : t("offerCardBody")}</p>
                <Link href="/rewards" className={`${goldPill} mt-3 h-9 self-start px-3.5 text-[12px]`}>
                  {t("viewOffers")}
                  <Icon name="arrow" size={13} />
                </Link>
              </div>
            </div>
            <Link href="/rewards" className="mt-3 flex items-center gap-3 rounded-xl px-3 py-2.5 text-[13px] hairline hover:border-gold/60">
              <IconBadge name="gift" />
              <span className="min-w-0 flex-1">
                <span className="block font-semibold">{t("referralSoon")}</span>
                <span className="block text-[12px] text-muted">{t("referralSoonBody")}</span>
              </span>
              <Icon name="chevron" size={14} className="text-muted" />
            </Link>
          </section>
        )}
        <section className="card p-5">
          <SectionHeading icon="compass" title={next ? t("recommendedTitle") : t("ideasTitle")} subtitle={next ? t("recommendedBody") : t("ideasBody")} href={siteLink(locale, "/blog")} more={t("moreArticles")} />
          <RecoGrid items={recs} />
        </section>
        <Dismissible id="learning-v1" label={t("hide")}>
          <section className="card h-full p-5">
            <SectionHeading icon="help" title={t("learningTitle")} subtitle={t("learningBody")} />
            <a href={teslaGuide?.href ?? "/help/guides/fsd-quick-start"} target={teslaGuide?.external ? "_blank" : undefined} rel={teslaGuide?.external ? "noreferrer" : undefined} className="flex items-center gap-3 rounded-xl bg-gold/10 px-4 py-3 text-[13px] hover:bg-gold/15">
              <Icon name="book" size={18} className="text-gold" />
              <span className="min-w-0 flex-1">
                <span className="block font-semibold">{t("newToTesla")}</span>
                <span className="block truncate text-[12px] text-muted">{teslaGuide?.title ?? t("newToTeslaBody")}</span>
              </span>
              <Icon name="chevron" size={14} className="text-muted" />
            </a>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <AskMoviaButton className="rounded-xl px-3 py-3 text-left text-[13px] hairline hover:border-gold/60">
                <Icon name="sparkle" size={16} className="text-gold" />
                <span className="mt-1.5 block font-semibold">{t("askMovia")}</span>
                <span className="block text-[12px] leading-snug text-muted">{t("askMoviaBody")}</span>
              </AskMoviaButton>
              <Link href="/messages?type=other" className="rounded-xl px-3 py-3 text-[13px] hairline hover:border-gold/60">
                <Icon name="headset" size={16} className="text-gold" />
                <span className="mt-1.5 block font-semibold">{t("talkHuman")}</span>
                <span className="block text-[12px] leading-snug text-muted">{t("talkHumanBody")}</span>
              </Link>
            </div>
          </section>
        </Dismissible>
      </div>

      {!next && lastPast && (
        <section className="mt-6">
          <SectionHeading title={t("lastTrip")} href="/trips?tab=past" more={t("allTrips")} />
          <Link href={`/trips/${lastPast.number}`} className="card flex items-center gap-4 p-4 transition-shadow hover:shadow-lift">
            <VehicleVisual slug={lastPast.vehicle_class?.slug} className="h-20 w-32 shrink-0 rounded-lg" sizes="8rem" />
            <span className="min-w-0">
              <span className="block font-semibold">{name(lastPast)}</span>
              <span className="block text-[13px] text-muted">
                {formatDay(lastPast.pickup_at, locale)} → {formatDay(lastPast.return_at, locale)} · {statuses(lastPast.status)}
              </span>
            </span>
          </Link>
        </section>
      )}
    </>
  );
}
