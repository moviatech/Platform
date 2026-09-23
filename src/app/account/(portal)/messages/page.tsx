import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import { loadPortalContent } from "@/features/portal/content";
import { MessagesLayout } from "@/features/portal/MessagesLayout";
import { listTrips } from "@/features/portal/queries";
import { listRequests } from "@/features/portal/request-queries";
import { RequestForm } from "@/features/portal/RequestForms";
import { PageIntro } from "@/features/portal/ui";
import { openStatuses } from "@/features/reservations/types";
import { requireCustomer } from "@/lib/auth/customer";
import { formatDay } from "@/lib/utils/format";

export const metadata: Metadata = { title: "Messages" };

type Props = { searchParams: Promise<{ type?: string; trip?: string; q?: string; status?: string }> };

export default async function MessagesPage({ searchParams }: Props) {
  const session = await requireCustomer();
  const { type, trip, q, status } = await searchParams;
  const [t, brand, locale, trips, requests, content] = await Promise.all([getTranslations("portal.messages"), getTranslations("portal.brand"), getLocale(), listTrips(session.customerId), listRequests(session.customerId), loadPortalContent()]);
  const open = trips.filter((item) => openStatuses.includes(item.status)).sort((a, b) => a.pickup_at.localeCompare(b.pickup_at));
  const options = [...trips]
    .sort((a, b) => b.pickup_at.localeCompare(a.pickup_at))
    .map((item) => ({ number: item.number, label: `${item.number} · ${locale === "zh" ? (item.vehicle_class?.name_zh ?? item.vehicle_class?.name) : item.vehicle_class?.name} · ${formatDay(item.pickup_at, locale)}` }));
  const context = open.find((item) => item.number === trip) ?? open.find((item) => item.status === "ACTIVE") ?? open[0] ?? null;

  return (
    <>
      <PageIntro title={t("title")} subtitle={t("subtitle")} tagline={[brand("t1"), brand("t2")]} />
      <MessagesLayout requests={requests} trip={context} content={content} query={q} status={status}>
        <section className="card flex min-h-[24rem] flex-col">
          <header className="flex items-center gap-3 border-b border-ink/[0.06] px-5 py-4">
            <span className="flex size-11 items-center justify-center rounded-full bg-gold text-[15px] font-semibold text-white">M</span>
            <span className="min-w-0">
              <span className="block text-[15px] font-semibold">{t("supportName")}</span>
              <span className="block text-[12px] text-muted">{t("supportLine")}</span>
            </span>
          </header>
          <div className="p-5 sm:p-6">
            <h2 className="mb-4 text-[15px] font-semibold">{t("newTitle")}</h2>
            <RequestForm trips={options} defaultType={type} defaultTrip={trip} />
          </div>
        </section>
      </MessagesLayout>
    </>
  );
}
