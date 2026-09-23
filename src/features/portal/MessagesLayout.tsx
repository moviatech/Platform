import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import { getLocale, getTranslations } from "next-intl/server";
import { cn } from "@/lib/utils/cn";
import type { PortalContent } from "./content";
import { Icon } from "./icons";
import type { Trip } from "./queries";
import type { RequestSummary } from "./request-queries";
import { bannerThumbs, DetailRow, ListLink, whitePill } from "./ui";

type Props = { requests: RequestSummary[]; activeId?: string; trip: Trip | null; content: PortalContent; query?: string; status?: string; children: ReactNode };

const zone = "America/Los_Angeles";
const filters = ["all", "open", "resolved"] as const;

export async function MessagesLayout({ requests, activeId, trip, content, query, status, children }: Props) {
  const [t, locale] = await Promise.all([getTranslations("portal.messages"), getLocale()]);
  const zh = locale === "zh";
  const className = trip ? (zh ? (trip.vehicle_class?.name_zh ?? trip.vehicle_class?.name) : trip.vehicle_class?.name) : null;
  const short = (value: string) => new Intl.DateTimeFormat(zh ? "zh-CN" : "en-US", { timeZone: zone, month: "short", day: "numeric" }).format(new Date(value));
  const time = (value: string) => new Intl.DateTimeFormat(zh ? "zh-CN" : "en-US", { timeZone: zone, hour: "numeric", minute: "2-digit" }).format(new Date(value));
  const term = (query ?? "").trim().toLowerCase();
  const filter = (filters as readonly string[]).includes(status ?? "") ? (status as (typeof filters)[number]) : "all";
  const visible = requests.filter((item) => {
    if (term && !`${item.subject ?? ""} ${item.last_message_preview ?? ""}`.toLowerCase().includes(term)) return false;
    if (filter === "open") return item.status === "OPEN" || item.status === "PENDING_CUSTOMER";
    if (filter === "resolved") return item.status === "RESOLVED";
    return true;
  });
  const href = (value: (typeof filters)[number]) => {
    const params = new URLSearchParams();
    if (term) params.set("q", query ?? "");
    if (value !== "all") params.set("status", value);
    const search = params.toString();
    return search ? `/messages?${search}` : "/messages";
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[18rem_minmax(0,1fr)] xl:grid-cols-[18rem_minmax(0,1fr)_17rem]">
      <section className={cn("card overflow-hidden", activeId && "hidden lg:block")}>
        <form action="/messages" className="border-b border-ink/[0.06] p-3">
          {filter !== "all" && <input type="hidden" name="status" value={filter} />}
          <label className="flex h-10 min-w-0 items-center gap-2 rounded-pill bg-pearl px-3.5 text-[13px] text-muted">
            <Icon name="search" size={15} />
            <input name="q" defaultValue={query ?? ""} placeholder={t("search")} className="min-w-0 flex-1 bg-transparent text-ink outline-none placeholder:text-muted" />
          </label>
          <div className="mt-2.5 flex items-center gap-1.5 text-[12px]">
            <Icon name="filter" size={13} className="text-muted" />
            {filters.map((value) => (
              <Link key={value} href={href(value)} className={cn("rounded-pill px-2.5 py-1 font-medium", filter === value ? "bg-gold/12 text-ink" : "text-muted hover:text-ink")}>
                {t(`filter.${value}`)}
              </Link>
            ))}
          </div>
        </form>
        {visible.length === 0 ? (
          <p className="px-4 py-6 text-[13px] text-muted">{t("empty")}</p>
        ) : (
          <ul className="max-h-[60dvh] divide-y divide-ink/[0.06] overflow-y-auto lg:max-h-[68dvh]">
            {visible.map((item) => {
              const unread = item.customer_unread;
              return (
                <li key={item.id}>
                  <Link href={`/messages/${item.id}`} className={cn("flex gap-3 px-4 py-3.5 hover:bg-pearl/70", item.id === activeId && "bg-gold/8")}>
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-gold text-[14px] font-semibold text-white">M</span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center justify-between gap-2">
                        <span className="truncate text-[13px] font-semibold">{item.subject ?? t("noSubject")}</span>
                        <span className="shrink-0 text-[11px] text-muted">{short(item.last_message_at)}</span>
                      </span>
                      <span className="mt-0.5 flex items-center gap-2">
                        <span className="min-w-0 flex-1 truncate text-[12px] text-muted">{item.last_message_preview ?? ""}</span>
                        {unread && <span className="size-2 shrink-0 rounded-full bg-gold" />}
                      </span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
        <div className="border-t border-ink/[0.06] p-3">
          <Link href="/messages" className={`${whitePill} h-9 w-full text-[12px]`}>
            <Icon name="plus" size={14} />
            {t("new")}
          </Link>
        </div>
      </section>
      <div className="min-w-0">{children}</div>
      <aside className="flex flex-col gap-4 lg:col-start-2 xl:col-start-auto">
        <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-1">
          {trip && (
            <section className="card p-4">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-[15px] font-semibold">{t("upcomingTrip")}</h2>
                <Link href={`/trips/${trip.number}`} className="flex items-center gap-0.5 text-[12px] font-medium text-gold hover:text-gold-light">
                  {t("viewDetails")}
                  <Icon name="chevron" size={13} />
                </Link>
              </div>
              <div className="relative mt-3 aspect-[16/9] overflow-hidden rounded-lg">
                <Image src={bannerThumbs.home} alt="" fill priority sizes="18rem" className="object-cover object-[65%_center]" />
              </div>
              <p className="mt-3 text-[15px] font-semibold">{className}</p>
              <div className="mt-3 grid grid-cols-2 gap-3">
                <DetailRow icon="calendar" label={t("pickup")} value={short(trip.pickup_at)} sub={time(trip.pickup_at)} />
                <DetailRow icon="calendar" label={t("return")} value={short(trip.return_at)} sub={time(trip.return_at)} />
                <DetailRow icon="pin" label={t("location")} value={(zh ? (trip.location?.name_zh ?? trip.location?.name) : trip.location?.name) ?? ""} />
                <DetailRow icon="clock" label={t("duration")} value={t("days", { count: trip.rental_days })} />
              </div>
              <Link href={`/trips/${trip.number}/modify`} className={`${whitePill} mt-4 w-full`}>
                {t("modify")}
              </Link>
            </section>
          )}
          <section className="card p-4">
            <h2 className="px-2 text-[15px] font-semibold">{t("moreHelp")}</h2>
            <p className="px-2 pb-2 text-[12px] text-muted">{t("moreHelpBody")}</p>
            {content.contact.phone && <ListLink href={`tel:${content.contact.phone.replace(/[^+\d]/g, "")}`} icon="phone" label={t("call")} sub={content.contact.phone} />}
            {content.contact.wechat && <ListLink href="/help" icon="chat" label={t("wechat")} sub={content.contact.wechat} />}
            <ListLink href="/messages?type=other" icon="headset" label={t("talkHuman")} sub={t("talkHumanBody")} />
          </section>
        </div>
      </aside>
    </div>
  );
}
