import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { listChangeRequests, pendingChangeStatuses } from "@/features/portal/change-queries";
import { listVehicleMedia } from "@/features/portal/garage";
import { Icon, type IconName } from "@/features/portal/icons";
import { listTrips } from "@/features/portal/queries";
import { listRecommendations } from "@/features/portal/recommendations";
import { siteLink } from "@/features/portal/site";
import { bannerThumbs, banners, goldPill, IconBadge, PageIntro, RecoList, SectionHeading, VehicleVisual, whitePill } from "@/features/portal/ui";
import { openStatuses } from "@/features/reservations/types";
import { requireCustomer } from "@/lib/auth/customer";
import { cn } from "@/lib/utils/cn";
import { formatDateTime } from "@/lib/utils/format";

export const metadata: Metadata = { title: "My vehicle" };

type Props = { searchParams: Promise<{ trip?: string }> };

export default async function VehiclePage({ searchParams }: Props) {
  const session = await requireCustomer();
  const { trip: selected } = await searchParams;
  const [t, brand, types, statuses, cats, locale, trips] = await Promise.all([
    getTranslations("portal.garage"),
    getTranslations("portal.brand"),
    getTranslations("portal.help.types"),
    getTranslations("reservations.status"),
    getTranslations("portal.blogCategories"),
    getLocale(),
    listTrips(session.customerId),
  ]);
  const label = (category: string) => (cats.has(category) ? cats(category) : category);
  const zh = locale === "zh";
  const open = trips.filter((item) => openStatuses.includes(item.status)).sort((a, b) => a.pickup_at.localeCompare(b.pickup_at));
  const trip = open.find((item) => item.number === selected) ?? open.find((item) => item.status === "ACTIVE") ?? open[0] ?? null;

  if (!trip) {
    return (
      <>
        <PageIntro title={t("title")} subtitle={t("subtitle")} tagline={[brand("t1"), brand("t2")]} />
        <div className="relative overflow-hidden rounded-[var(--radius-card)] bg-ink text-white">
          <Image src={banners.front} alt="" fill sizes="(min-width: 1024px) 64rem, 100vw" className="object-cover" priority />
          <div className="absolute inset-0 bg-gradient-to-r from-ink/80 via-ink/40 to-transparent" />
          <div className="relative flex min-h-[18rem] flex-col justify-center p-6 sm:p-10">
            <h2 className="max-w-md text-[2.2rem] leading-tight font-semibold tracking-tight">{t("empty")}</h2>
            <a href={siteLink(locale, "/book")} className={`${goldPill} mt-5 self-start`}>
              {t("browse")}
              <Icon name="arrow" size={14} />
            </a>
          </div>
        </div>
      </>
    );
  }

  const [media, requests, recs] = await Promise.all([listVehicleMedia(trip.assigned_vehicle_id ? [trip.assigned_vehicle_id] : []), listChangeRequests(trip.id), listRecommendations("booked", locale, 3, label)]);
  const items = trip.assigned_vehicle_id ? (media[trip.assigned_vehicle_id] ?? []) : [];
  const photos = items.filter((item) => item.kind === "IMAGE");
  const videos = items.filter((item) => item.kind === "VIDEO");
  const className = (zh ? (trip.vehicle_class?.name_zh ?? trip.vehicle_class?.name) : trip.vehicle_class?.name) ?? "";
  const tier = trip.vehicle_class?.slug?.includes("premium") ? "Premium" : trip.vehicle_class?.slug === "model-y-l" ? "L" : "Basic";
  const seats = trip.vehicle_class?.seats ?? 5;
  const instructions = zh ? (trip.location?.pickup_instructions_zh ?? trip.location?.pickup_instructions) : trip.location?.pickup_instructions;
  const pending = requests.filter((request) => pendingChangeStatuses.includes(request.status));
  const placeName = (zh ? (trip.location?.name_zh ?? trip.location?.name) : trip.location?.name) ?? "";
  const allHighlights: Array<{ icon: IconName; title: string; body: string; show: boolean }> = [
    { icon: "sparkle", title: t("hl.fsd"), body: t("hl.fsdBody"), show: true },
    { icon: "seat", title: t("hl.premium"), body: t("hl.premiumBody"), show: tier === "Premium" },
    { icon: "users", title: t("hl.seats", { count: seats }), body: t("hl.seatsBody"), show: true },
    { icon: "bolt", title: t("hl.electric"), body: t("hl.electricBody"), show: true },
    { icon: "compass", title: t("hl.charging"), body: t("hl.chargingBody"), show: true },
  ];
  const highlights = allHighlights.filter((item) => item.show).slice(0, 4);
  const glance: Array<{ icon: IconName; label: string; value: string; sub?: string }> = [
    { icon: "compass", label: t("range"), value: trip.vehicle_class?.range_miles ? t("rangeValue", { miles: trip.vehicle_class.range_miles }) : "—" },
    { icon: "users", label: t("seating"), value: t("seatsValue", { count: seats }) },
    { icon: "bolt", label: t("charging"), value: t("chargingValue"), sub: t("chargingSub") },
    { icon: "calendar", label: t("readiness"), value: statuses(trip.status), sub: `${formatDateTime(trip.pickup_at, locale)} · ${placeName}` },
  ];
  const galleryTiles: Array<{ key: string; image: string; label: string; meta: string; video?: boolean }> = [
    { key: "exterior", image: bannerThumbs.home, label: t("cat.exterior"), meta: t("placeholder") },
    { key: "interior", image: bannerThumbs.interior, label: t("cat.interior"), meta: t("placeholder") },
    { key: "dashboard", image: bannerThumbs.interior, label: t("cat.dashboard"), meta: t("placeholder") },
    { key: "cargo", image: bannerThumbs.front, label: t("cat.cargo"), meta: t("placeholder") },
    { key: "walkaround", image: bannerThumbs.home, label: t("cat.walkaround"), meta: t("videoSoon"), video: true },
  ];

  return (
    <>
      <PageIntro
        title={t("title")}
        subtitle={t("subtitle")}
        tagline={[brand("t1"), brand("t2")]}
        actions={
          open.length > 1 ? (
            <div className="flex flex-wrap gap-1 rounded-pill bg-white p-1 hairline">
              {open.map((item) => (
                <Link key={item.id} href={`/vehicle?trip=${item.number}`} className={cn("rounded-pill px-3 py-1.5 text-[12px] font-medium", item.id === trip.id ? "bg-gold text-white" : "text-charcoal")}>
                  {item.number}
                </Link>
              ))}
            </div>
          ) : undefined
        }
      />

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_19rem]">
        <section className="relative min-h-[22rem] overflow-hidden rounded-[var(--radius-card)] bg-ink text-white">
          <Image src={photos[0]?.url ?? banners.home} alt="" fill unoptimized={Boolean(photos[0])} priority sizes="(min-width: 1024px) 50rem, 100vw" className="object-cover object-[65%_center]" />
          <div className="absolute inset-0 bg-gradient-to-r from-ink/80 via-ink/35 to-transparent" />
          <div className="absolute inset-0 flex flex-col justify-between p-6 sm:p-8">
            <div className="flex items-start justify-between gap-4">
              <p className="text-[10px] tracking-[0.28em] text-white/85 uppercase">{photos.length ? t("assignedVehicle") : t("upcomingRide")}</p>
            </div>
            <div>
              <h2 className="text-[2.4rem] leading-[1.05] font-semibold tracking-tight">{className}</h2>
              <p className="mt-2 text-[14px] text-white/85">{t("heroLine")}</p>
              <div className="mt-4 flex flex-wrap gap-2">
                {[
                  { icon: "sparkle" as IconName, label: "FSD (Supervised)" },
                  { icon: "car" as IconName, label: tier },
                  { icon: "users" as IconName, label: t("seatsValue", { count: seats }) },
                ].map((badge) => (
                  <span key={badge.label} className="inline-flex items-center gap-1.5 rounded-pill bg-white/90 px-3 py-1.5 text-[12px] font-medium text-ink">
                    <Icon name={badge.icon} size={13} className="text-gold" />
                    {badge.label}
                  </span>
                ))}
              </div>
              <div className="mt-5 flex flex-wrap gap-2">
                <a href="#gallery" className={goldPill}>
                  {t("viewGallery")}
                  <Icon name="arrow" size={14} />
                </a>
                {videos.length > 0 ? (
                  <a href="#videos" className={`${whitePill} border-transparent`}>
                    <Icon name="play" size={15} />
                    {t("watchPreview")}
                  </a>
                ) : (
                  <span className={`${whitePill} cursor-default border-transparent bg-white/70 text-muted`}>
                    <Icon name="play" size={15} />
                    {t("previewSoon")}
                  </span>
                )}
              </div>
            </div>
          </div>
        </section>
        <aside className="card p-5">
          <h2 className="text-[17px] font-semibold tracking-tight">{t("glance")}</h2>
          <ul className="mt-2 flex flex-col divide-y divide-ink/[0.06]">
            {glance.map((row) => (
              <li key={row.label} className="flex items-start gap-3 py-3.5 text-[13px]">
                <IconBadge name={row.icon} className="mt-0.5" />
                <span className="min-w-0 flex-1">
                  <span className="block text-[12px] text-muted">{row.label}</span>
                  <span className={cn("block font-semibold", row.icon === "calendar" && "text-gold")}>{row.value}</span>
                  {row.sub && <span className="block text-[12px] text-muted">{row.sub}</span>}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-2 flex gap-2 rounded-xl bg-gold/8 px-3.5 py-3 text-[12px] leading-relaxed text-charcoal">
            <Icon name="alert" size={14} className="mt-0.5 shrink-0 text-gold" />
            {t("assignmentNote")}
          </p>
        </aside>
      </div>

      <section id="gallery" className="card mt-5 p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-4">
            <h2 className="flex items-center gap-2 text-[17px] font-semibold tracking-tight">
              <Icon name="image" size={18} className="text-gold" />
              {t("gallery")}
            </h2>
            <span className="flex gap-1 text-[13px]">
              <span className="border-b-2 border-gold px-2 pb-1 font-medium">{t("photos")}</span>
              <span className="px-2 pb-1 text-muted">{t("videos")}</span>
            </span>
          </div>
          <span className="flex items-center gap-1 text-[13px] font-medium text-gold">
            {t("viewAll")}
            <Icon name="arrow" size={14} />
          </span>
        </div>
        {photos.length > 0 ? (
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {photos.map((item) => (
              <a key={item.id} href={item.url} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-xl bg-pearl">
                <Image src={item.url} alt={item.caption ?? ""} width={640} height={480} unoptimized className="aspect-[4/3] w-full object-cover transition-transform hover:scale-[1.02]" />
              </a>
            ))}
          </div>
        ) : (
          <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <li>
              <VehicleVisual slug={trip.vehicle_class?.slug} className="aspect-[4/3] rounded-xl" sizes="16rem" />
              <p className="mt-2 text-[13px] font-semibold">
                {t("cat.model")} <span className="font-normal text-muted">· {t("placeholder")}</span>
              </p>
            </li>
            {galleryTiles.map((tile) => (
              <li key={tile.key}>
                <div className="relative aspect-[4/3] overflow-hidden rounded-xl bg-pearl">
                  <Image src={tile.image} alt="" fill sizes="16rem" className="object-cover" />
                  {tile.video && (
                    <span className="absolute inset-0 flex items-center justify-center">
                      <span className="flex size-11 items-center justify-center rounded-full bg-white/90 text-ink">
                        <Icon name="play" size={18} />
                      </span>
                    </span>
                  )}
                </div>
                <p className="mt-2 text-[13px] font-semibold">
                  {tile.label} <span className="font-normal text-muted">· {tile.meta}</span>
                </p>
              </li>
            ))}
          </ul>
        )}
        {videos.length > 0 && (
          <div id="videos" className="mt-4 grid gap-3 sm:grid-cols-2">
            {videos.map((item) => (
              <video key={item.id} controls preload="metadata" src={item.url} className="aspect-video w-full rounded-xl bg-ink" />
            ))}
          </div>
        )}
      </section>

      <div className="mt-5 grid gap-4 lg:grid-cols-3">
        <section className="card p-5">
          <SectionHeading icon="book" title={t("quickStart")} subtitle={t("quickStartBody")} href={siteLink(locale, "/blog")} more={t("allGuides")} />
          <RecoList items={recs} />
        </section>
        <section className="card p-5">
          <SectionHeading icon="sparkle" title={t("highlights")} subtitle={t("highlightsBody")} />
          <ul className="flex flex-col divide-y divide-ink/[0.06]">
            {highlights.map((item) => (
              <li key={item.title} className="flex items-center gap-3 py-3">
                <IconBadge name={item.icon} />
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] font-semibold">{item.title}</span>
                  <span className="block text-[12px] text-muted">{item.body}</span>
                </span>
                <Icon name="chevron" size={14} className="text-muted" />
              </li>
            ))}
          </ul>
        </section>
        <section className="card p-5">
          <SectionHeading icon="luggage" title={t("notes")} subtitle={t("notesBody")} />
          {pending.length === 0 ? (
            <div className="flex items-start gap-3 rounded-xl bg-status-available/10 px-4 py-3.5">
              <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-status-available text-white">
                <Icon name="check" size={11} />
              </span>
              <span>
                <span className="block text-[13px] font-semibold">{t("noRequests")}</span>
                <span className="block text-[12px] text-muted">{t("noRequestsBody")}</span>
              </span>
            </div>
          ) : (
            <ul className="flex flex-col gap-2">
              {pending.map((request) => (
                <li key={request.id} className="rounded-xl bg-pearl px-4 py-3 text-[13px]">
                  <span className="font-semibold">{types.has(request.kind) ? types(request.kind) : request.kind}</span>
                  <span className="block text-[12px] text-muted">{formatDateTime(request.created_at, locale)}</span>
                </li>
              ))}
            </ul>
          )}
          <Link href={`/trips/${trip.number}/modify?action=special`} className={`${whitePill} mt-4 w-full`}>
            <Icon name="plus" size={14} />
            {t("addRequest")}
            <Icon name="arrow" size={14} />
          </Link>
          {instructions && (
            <p className="mt-4 flex gap-2 border-t border-ink/[0.06] pt-4 text-[12px] leading-relaxed text-charcoal">
              <Icon name="pin" size={14} className="mt-0.5 shrink-0 text-gold" />
              {instructions}
            </p>
          )}
        </section>
      </div>
    </>
  );
}
