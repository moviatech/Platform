import type { Metadata } from "next";
import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/ops/PageHeader";
import { currentTime, zonedParts, zonedToUtc } from "@/features/booking/time";
import { isAcceptingBookings } from "@/features/booking/status";
import { toggleBookings } from "@/features/booking/status-actions";
import { countOpenConversations } from "@/features/inbox/queries";
import { loadExceptions, type ExceptionCounts } from "@/features/overview/exceptions";
import { listTodayMovements } from "@/features/reservations/queries";
import type { ReservationListItem } from "@/features/reservations/types";
import { can, getStaffSession } from "@/lib/auth/staff";
import { formatDateTime } from "@/lib/utils/format";

export const metadata: Metadata = { title: "Overview" };

const zone = "America/Los_Angeles";

function Stat({ label, value, hint, href }: { label: string; value: number; hint?: string; href: string }) {
  return (
    <Link href={href} className="card block p-5 transition-shadow hover:shadow-lift">
      <p className="text-[13px] text-muted">{label}</p>
      <p className="mt-1.5 text-3xl font-semibold tracking-tight tabular-nums">{value}</p>
      {hint && <p className="mt-1.5 text-xs text-muted">{hint}</p>}
    </Link>
  );
}

function Movements({ title, items, field, empty, locale }: { title: string; items: ReservationListItem[]; field: "pickup_at" | "return_at"; empty: string; locale: string }) {
  const now = currentTime();
  return (
    <section className="card p-5">
      <h2 className="text-sm font-semibold">{title}</h2>
      {items.length === 0 ? (
        <p className="mt-3 text-[13px] text-muted">{empty}</p>
      ) : (
        <ul className="mt-3 flex flex-col gap-2">
          {items.map((item) => {
            const overdue = field === "return_at" && new Date(item.return_at).getTime() < now;
            return (
              <li key={item.id}>
                <Link href={`/reservations/${item.id}`} className="flex items-center justify-between gap-3 rounded-xl border border-ink/[0.07] px-3.5 py-2.5 text-[13px] hover:border-gold/50">
                  <span className="min-w-0 truncate">
                    <span className="font-medium">{item.customer?.full_name ?? item.number}</span>
                    <span className="text-muted"> · {item.vehicle?.fleet_number ?? "—"}</span>
                  </span>
                  <span className={overdue ? "shrink-0 font-medium text-status-danger" : "shrink-0 text-charcoal"}>{formatDateTime(item[field], locale)}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

export default async function OverviewPage() {
  const session = await getStaffSession();
  const t = await getTranslations("overview");
  const locale = await getLocale();
  const showTrips = can(session, "reservation.view");
  const showInbox = can(session, "inbox.view");

  const today = zonedParts(new Date(), zone).date;
  const dayStart = zonedToUtc(today, "00:00", zone);
  const dayEnd = new Date(dayStart.getTime() + 86400000);

  const showBookings = can(session, "settings.manage");
  const [movements, unread, accepting, exceptions] = await Promise.all([
    showTrips ? listTodayMovements(dayStart, dayEnd) : { pickups: [], returns: [], requested: 0 },
    showInbox ? countOpenConversations() : 0,
    showBookings ? isAcceptingBookings() : true,
    showTrips ? loadExceptions() : null,
  ]);
  const attention: Array<{ key: keyof ExceptionCounts; href: string }> = [
    { key: "pendingRequests", href: "/reservations?status=CONFIRMED" },
    { key: "unsignedSoon", href: "/reservations?status=CONFIRMED" },
    { key: "unverifiedSoon", href: "/reservations?status=CONFIRMED" },
    { key: "unpaidSoon", href: "/reservations?status=CONFIRMED" },
    { key: "holdsExpiring", href: "/reservations?status=ACTIVE" },
    { key: "overdue", href: "/reservations?status=ACTIVE" },
    { key: "refundsFailed", href: "/reservations" },
  ];
  const open = exceptions ? attention.filter((item) => exceptions[item.key] > 0) : [];

  return (
    <>
      <PageHeader eyebrow={t("eyebrow")} title={t("title")} lead={t("greeting", { name: session.displayName })} />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {showTrips && <Stat label={t("pickupsToday")} value={movements.pickups.length} href="/reservations" />}
        {showTrips && <Stat label={t("requested")} value={movements.requested} hint={t("requestedHint")} href="/reservations?status=REQUESTED" />}
        {showInbox && <Stat label={t("unreadInbox")} value={unread} href="/inbox" />}
        {showBookings && (
          <form action={toggleBookings} className="card flex items-center justify-between gap-3 p-5">
            <input type="hidden" name="value" value={accepting ? "0" : "1"} />
            <span>
              <span className="block text-[13px] text-muted">{t("bookings")}</span>
              <span className={accepting ? "mt-1 block text-2xl font-semibold text-status-available" : "mt-1 block text-2xl font-semibold text-status-danger"}>{accepting ? t("bookingsOpen") : t("bookingsPaused")}</span>
            </span>
            <button type="submit" className="rounded-pill px-3.5 py-1.5 text-[13px] font-medium text-ink hairline hover:border-ink/25">
              {accepting ? t("bookingsPause") : t("bookingsResume")}
            </button>
          </form>
        )}
      </div>
      {exceptions && (
        <section className="card mt-5 p-5">
          <h2 className="text-xs font-medium tracking-wide text-muted">{t("attention")}</h2>
          {open.length === 0 ? (
            <p className="mt-3 text-sm text-muted">{t("attentionNone")}</p>
          ) : (
            <ul className="mt-3 flex flex-wrap gap-2">
              {open.map((item) => (
                <li key={item.key}>
                  <Link href={item.href} className="inline-flex items-center gap-2 rounded-pill px-3.5 py-1.5 text-[13px] hairline hover:border-ink/25">
                    <span className="font-semibold text-status-danger">{exceptions[item.key]}</span>
                    {t(`attentionItems.${item.key}`)}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
      {showTrips && (
        <div className="mt-5 grid gap-5 lg:grid-cols-2">
          <Movements title={t("pickupsToday")} items={movements.pickups} field="pickup_at" empty={t("noneToday")} locale={locale} />
          <Movements title={t("returnsDue")} items={movements.returns} field="return_at" empty={t("noneToday")} locale={locale} />
        </div>
      )}
    </>
  );
}
