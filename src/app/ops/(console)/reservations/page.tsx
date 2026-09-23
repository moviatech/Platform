import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { ButtonLink } from "@/components/ui/Button";
import { PageHeader } from "@/components/ops/PageHeader";
import { listReservations, type ReservationFilters } from "@/features/reservations/queries";
import { ReservationTable } from "@/features/reservations/ReservationTable";
import { can, requirePagePermission } from "@/lib/auth/staff";
import { cn } from "@/lib/utils/cn";

export const metadata: Metadata = { title: "Reservations" };

type Props = { searchParams: Promise<ReservationFilters> };

export default async function ReservationsPage({ searchParams }: Props) {
  const session = await requirePagePermission("reservation.view");
  const filters = await searchParams;
  const t = await getTranslations("reservations");
  const common = await getTranslations("common");
  const reservations = await listReservations(filters);
  const current = filters.status ?? "open";

  const tabs = [
    { key: "open", label: t("tabs.open"), href: "/reservations" },
    ...(["REQUESTED", "CONFIRMED", "ACTIVE", "COMPLETED", "CANCELLED"] as const).map((status) => ({ key: status as string, label: t(`status.${status}`), href: `/reservations?status=${status}` })),
    { key: "all", label: common("all"), href: "/reservations?status=all" },
  ];

  return (
    <>
      <PageHeader
        title={t("title")}
        lead={t("lead")}
        actions={
          <div className="flex gap-2">
            <ButtonLink href="/reservations/timeline" size="sm" variant="secondary">
              {t("timeline.title")}
            </ButtonLink>
            {can(session, "reservation.create") && (
              <ButtonLink href="/reservations/new" size="sm">
                {t("new")}
              </ButtonLink>
            )}
          </div>
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="no-scrollbar flex gap-1.5 overflow-x-auto">
          {tabs.map((tab) => (
            <Link
              key={tab.key}
              href={tab.href}
              className={cn("shrink-0 rounded-pill px-3.5 py-1.5 text-[13px] transition-colors", current === tab.key ? "bg-ink text-white" : "bg-white text-charcoal hairline hover:border-ink/20")}
            >
              {tab.label}
            </Link>
          ))}
        </div>
        <form action="/reservations" className="ml-auto">
          {filters.status && <input type="hidden" name="status" value={filters.status} />}
          <input
            type="search"
            name="q"
            defaultValue={filters.q ?? ""}
            placeholder={t("search")}
            className="h-9 w-44 rounded-xl border border-ink/10 bg-white px-3 text-[13px] placeholder:text-muted/70 focus:border-gold/60 focus:outline-none focus:ring-4 focus:ring-gold/10"
          />
        </form>
      </div>
      <ReservationTable reservations={reservations} />
    </>
  );
}
