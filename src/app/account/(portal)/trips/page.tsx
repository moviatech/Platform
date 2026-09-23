import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { tripDate } from "@/features/portal/dates";
import { Icon } from "@/features/portal/icons";
import { listTrips, type Trip } from "@/features/portal/queries";
import { siteLink } from "@/features/portal/site";
import { bannerThumbs, banners, DetailRow, goldPill, IconBadge, ListLink, PageIntro, SectionHeading, whitePill } from "@/features/portal/ui";
import { openStatuses } from "@/features/reservations/types";
import { requireCustomer } from "@/lib/auth/customer";
import { cn } from "@/lib/utils/cn";
import { formatMoney } from "@/lib/utils/format";

export const metadata: Metadata = { title: "My trips" };

type Props = { searchParams: Promise<{ tab?: string }> };

const tabs = ["upcoming", "active", "past"] as const;
const thumbs = [bannerThumbs.home, bannerThumbs.front, bannerThumbs.interior];

export default async function TripsPage({ searchParams }: Props) {
  const session = await requireCustomer();
  const { tab } = await searchParams;
  const [t, brand, statuses, locale, trips] = await Promise.all([getTranslations("portal.trips"), getTranslations("portal.brand"), getTranslations("reservations.status"), getLocale(), listTrips(session.customerId)]);
  const zh = locale === "zh";
  const groups: Record<(typeof tabs)[number], Trip[]> = {
    upcoming: trips.filter((trip) => ["REQUESTED", "PENDING_PAYMENT", "CONFIRMED"].includes(trip.status)).sort((a, b) => a.pickup_at.localeCompare(b.pickup_at)),
    active: trips.filter((trip) => trip.status === "ACTIVE"),
    past: trips.filter((trip) => ["COMPLETED", "CANCELLED", "NO_SHOW", "EXPIRED"].includes(trip.status)).sort((a, b) => b.pickup_at.localeCompare(a.pickup_at)),
  };
  const active = (tabs as readonly string[]).includes(tab ?? "") ? (tab as (typeof tabs)[number]) : groups.upcoming.length ? "upcoming" : groups.active.length ? "active" : "past";
  const list = groups[active];
  const [featured, ...rest] = list;
  const past = active === "past" ? rest : groups.past;
  const name = (trip: Trip) => (zh ? (trip.vehicle_class?.name_zh ?? trip.vehicle_class?.name) : trip.vehicle_class?.name) ?? "";
  const place = (trip: Trip) => (trip.pickup_method === "DELIVERY" && trip.delivery_address ? trip.delivery_address : ((zh ? (trip.location?.name_zh ?? trip.location?.name) : trip.location?.name) ?? ""));
  const isOpen = Boolean(featured && openStatuses.includes(featured.status));
  const changeable = Boolean(featured && ["REQUESTED", "PENDING_PAYMENT", "CONFIRMED", "ACTIVE"].includes(featured.status));
  const checklist =
    featured && active === "upcoming"
      ? [
          { label: t("check.confirmed"), done: featured.status === "CONFIRMED" },
          { label: t("check.license"), done: featured.verification_state === "VERIFIED" },
          { label: t("check.payment"), done: ["PAID", "PARTIALLY_REFUNDED"].includes(featured.payment_state) || featured.rate_plan === "PAY_LATER" },
          { label: t("check.ready"), done: featured.agreement_state === "SIGNED" },
        ]
      : [];
  const doneCount = checklist.filter((item) => item.done).length;
  const pickup = featured ? tripDate(featured.pickup_at, locale) : null;
  const dropoff = featured ? tripDate(featured.return_at, locale) : null;

  const card = (trip: Trip, index: number) => {
    const p = tripDate(trip.pickup_at, locale);
    const r = tripDate(trip.return_at, locale);
    return (
      <li key={trip.id} className="card overflow-hidden">
        <div className="relative aspect-[16/10]">
          <Image src={thumbs[index % thumbs.length]} alt="" fill sizes="22rem" className="object-cover" />
          <span className="absolute top-3 left-3 rounded-pill bg-white/90 px-2.5 py-1 text-[11px] font-medium text-ink">
            {p.date} – {r.date}
          </span>
        </div>
        <div className="p-4">
          <p className="text-[15px] font-semibold">{name(trip)}</p>
          <p className="mt-1.5 flex items-center gap-1.5 text-[12px] text-charcoal">
            <Icon name="car" size={13} className="text-muted" />
            {trip.number} · {statuses(trip.status)}
          </p>
          <p className="mt-1 flex items-center gap-1.5 text-[12px] text-charcoal">
            <Icon name="pin" size={13} className="text-muted" />
            {place(trip)}
          </p>
          <div className="mt-3 flex items-center gap-2">
            <Link href={`/trips/${trip.number}`} className={`${whitePill} h-9 px-3.5 text-[12px]`}>
              {t("viewDetails")}
            </Link>
            <span className="h-5 w-px bg-ink/10" />
            <Link href={`/trips/${trip.number}#charges`} className="flex items-center gap-1.5 text-[12px] font-medium text-charcoal hover:text-gold">
              <Icon name="doc" size={14} />
              {t("receipt")}
            </Link>
          </div>
        </div>
      </li>
    );
  };

  return (
    <>
      <PageIntro title={t("title")} subtitle={t("subtitle")} tagline={[brand("t1"), brand("t2")]} />

      <div className="mb-4 inline-flex rounded-pill bg-white p-1 hairline">
        {tabs.map((item) => (
          <Link key={item} href={`/trips?tab=${item}`} className={cn("rounded-pill px-6 py-2.5 text-[13px] font-medium transition-colors", active === item ? "bg-gold text-white" : "text-charcoal hover:text-ink")}>
            {t(`tabs.${item}`)} ({groups[item].length})
          </Link>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="flex min-w-0 flex-col gap-6">
          {!featured ? (
            <div className="card px-6 py-14 text-center">
              <IconBadge name="calendar" size={10} className="mx-auto" />
              <p className="mt-3 text-sm text-muted">{t(`empty.${active}`)}</p>
              <a href={siteLink(locale, "/vehicles")} className={`${goldPill} mt-5`}>
                {t("browse")}
                <Icon name="arrow" size={14} />
              </a>
            </div>
          ) : (
            <section className="card grid overflow-hidden lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
              <div className="relative min-h-[16rem]">
                <Image src={banners.home} alt="" fill priority sizes="(min-width: 1024px) 28rem, 100vw" className="object-cover object-[60%_center]" />
                <div className="absolute inset-0 bg-gradient-to-t from-ink/70 via-ink/15 to-ink/10" />
                <div className="absolute inset-0 flex flex-col justify-between p-5 text-white sm:p-6">
                  <p className="text-[10px] tracking-[0.28em] text-white/85 uppercase">{t(`featured.${active}`)}</p>
                  <p className="text-[2.1rem] leading-[1.05] font-light tracking-tight">{name(featured)}</p>
                </div>
              </div>
              <div className="flex flex-col gap-4 p-5 sm:p-6">
                <div className="flex items-center justify-between gap-3">
                  <span className="inline-flex items-center gap-1.5 rounded-pill bg-gold/12 px-3 py-1.5 text-[12px] font-medium text-ink">
                    <span className="flex size-4 items-center justify-center rounded-full bg-gold text-white">
                      <Icon name="check" size={10} />
                    </span>
                    {statuses(featured.status)}
                  </span>
                  <span className="text-[12px] text-muted">{t("reservationNo", { number: featured.number })}</span>
                </div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                  <DetailRow icon="calendar" label={t("pickup")} value={pickup?.date} sub={pickup?.time} />
                  <DetailRow icon="calendar" label={t("return")} value={dropoff?.date} sub={dropoff?.time} />
                  <div className="col-span-2">
                    <DetailRow icon="pin" label={t("location")} value={place(featured)} />
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Link href={`/trips/${featured.number}`} className={goldPill}>
                    {t("viewTrip")}
                    <Icon name="arrow" size={14} />
                  </Link>
                  {changeable && (
                    <Link href={`/trips/${featured.number}/modify`} className={whitePill}>
                      {t("modify")}
                    </Link>
                  )}
                  {isOpen && (
                    <Link href={`/messages?trip=${featured.number}`} className={whitePill}>
                      <Icon name="headset" size={15} />
                      {t("getHelp")}
                    </Link>
                  )}
                </div>
                {checklist.length > 0 && (
                  <div className="border-t border-ink/[0.06] pt-4">
                    <div className="flex items-center justify-between gap-3 text-[13px]">
                      <span className="font-semibold">{t("checklist")}</span>
                      <span className="flex items-center gap-2 text-muted">
                        {t("checklistProgress", { done: doneCount, total: checklist.length })}
                        <span className="h-1.5 w-24 overflow-hidden rounded-pill bg-pearl">
                          <span className="block h-full rounded-pill bg-gold" style={{ width: `${(doneCount / checklist.length) * 100}%` }} />
                        </span>
                      </span>
                    </div>
                    <ul className="mt-3 grid grid-cols-2 gap-3 xl:grid-cols-4">
                      {checklist.map((item) => (
                        <li key={item.label} className="flex items-start gap-2 text-[12px] leading-snug">
                          <span className={cn("mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full", item.done ? "bg-gold text-white" : "border border-ink/20")}>{item.done && <Icon name="check" size={11} />}</span>
                          {item.label}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </section>
          )}
          {active !== "past" && rest.length > 0 && (
            <section>
              <SectionHeading title={t(`more.${active}`)} />
              <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{rest.map(card)}</ul>
            </section>
          )}
          {past.length > 0 && (
            <section>
              <SectionHeading title={active === "past" ? t("more.past") : t("pastTitle")} href="/trips?tab=past" more={t("viewAll")} />
              <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{past.slice(0, 3).map(card)}</ul>
            </section>
          )}
        </div>
        <aside className="flex flex-col gap-4">
          {featured && (
            <section className="card p-4">
              <h2 className="flex items-center gap-2 px-2 pb-2 text-[15px] font-semibold">
                <Icon name="doc" size={16} className="text-gold" />
                {t("documents")}
              </h2>
              <ListLink href={`/trips/${featured.number}/agreement`} icon="doc" label={t("agreement")} meta={featured.agreement_state === "SIGNED" ? t("signed") : isOpen ? t("toSign") : undefined} />
              <ListLink href={`/trips/${featured.number}#charges`} icon="doc" label={t("invoice")} meta={formatMoney(featured.total_cents)} />
              {isOpen && <ListLink href={`/vehicle?trip=${featured.number}`} icon="doc" label={t("pickupInstructions")} />}
            </section>
          )}
          {featured && changeable && (
            <section className="card p-4">
              <h2 className="flex items-center gap-2 px-2 text-[15px] font-semibold">
                <Icon name="calendar" size={16} className="text-gold" />
                {t("changePlans")}
              </h2>
              <p className="px-2 pb-2 text-[12px] text-muted">{t("changePlansBody")}</p>
              <ListLink href={`/trips/${featured.number}/modify?action=extend`} icon="clock" label={t("extend")} />
              <ListLink href={`/trips/${featured.number}/modify?action=return-time`} icon="calendar" label={t("changeReturn")} />
              <ListLink href={`/trips/${featured.number}/modify?action=add-driver`} icon="user" label={t("addDriver")} />
              <Link href={`/messages?trip=${featured.number}`} className="mt-2 flex items-center gap-2 rounded-lg bg-gold/8 px-3 py-2.5 text-[12px] text-charcoal hover:bg-gold/15">
                <Icon name="alert" size={14} className="text-gold" />
                {t("somethingElse")}
              </Link>
            </section>
          )}
        </aside>
      </div>
    </>
  );
}
