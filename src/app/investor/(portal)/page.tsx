import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { zonedParts } from "@/features/booking/time";
import { AssetCard } from "@/features/investor/AssetCard";
import { listAssetCards } from "@/features/investor/assets";
import { dashboardSummary, monthLabel, monthsBack, shortMonth, trend } from "@/features/investor/earnings";
import { loadBalances } from "@/features/investor/ledger";
import { loadMemberPosition } from "@/features/investor/members";
import { MemberStrip } from "@/features/investor/MemberStrip";
import { ownerOverview } from "@/features/investor/owner";
import { TrendChart } from "@/features/investor/TrendChart";
import { listInvestorNotifications, renderParams } from "@/features/notifications/center";
import { Icon } from "@/features/portal/icons";
import { goldPill, IconBadge, PageIntro, SectionHeading, whitePill } from "@/features/portal/ui";
import { requireInvestor } from "@/lib/auth/investor";
import { formatDate, formatDateTime, formatMoney } from "@/lib/utils/format";

export const metadata: Metadata = { title: "Overview" };

export default async function InvestorHomePage() {
  const session = await requireInvestor();
  const [t, tm, ta, kinds, ownerKinds, locale] = await Promise.all([getTranslations("investor.home"), getTranslations("investor.member"), getTranslations("investor.assets"), getTranslations("investor.notifications.kinds"), getTranslations("investor.notifications.owner"), getLocale()]);
  const today = zonedParts(new Date(), "America/Los_Angeles").date;
  const month = today.slice(0, 7);
  const [position, company, assets, notifications] = await Promise.all([session.memberId ? loadMemberPosition(session.memberId, session.ownerId) : null, loadBalances(session.ownerId), listAssetCards(session.ownerId, locale), listInvestorNotifications(session.investorId, 6)]);
  const balances = position ?? company;
  const active = [...assets.filter((asset) => asset.status !== "ENDED")].sort((a, b) => b.effective_from.localeCompare(a.effective_from) || b.created_at.localeCompare(a.created_at));
  const [summary, points, owner, companySummary] = await Promise.all([dashboardSummary(session.ownerId, active, month, session.memberId), trend(session.ownerId, month, 6, session.memberId), session.perMile ? ownerOverview(session.ownerId, month) : null, session.memberId ? dashboardSummary(session.ownerId, active, month) : null]);
  const label = (kind: string, params: Record<string, string>) => (owner && ownerKinds.has(kind) ? ownerKinds(kind, params) : kinds.has(kind) ? kinds(kind, params) : kind);
  const feed = notifications.map((item) => ({ id: item.id, at: item.created_at, text: label(item.kind, renderParams(item.params, locale)), href: `/notifications/${item.id}` }));
  const companyAvailable = position ? tm("companyTotal", { amount: formatMoney(company.availableCents) }) : null;
  const stats = owner
    ? [
        { icon: "coins" as const, label: t("owner.lastFee"), value: owner.last.length ? formatMoney(owner.lastCents) : "—", sub: owner.last.length ? t("owner.lastFeeSub", { month: monthLabel(owner.lastMonth, locale), miles: owner.lastMiles.toLocaleString("en-US") }) : t("owner.noStatement"), company: null },
        { icon: "list" as const, label: t("owner.settledTotal"), value: formatMoney(summary.settledTotalCents), sub: null, company: null },
        { icon: "card" as const, label: t("available"), value: formatMoney(balances.availableCents), sub: balances.pendingCents > 0 ? t("pendingBalance", { amount: formatMoney(balances.pendingCents) }) : null, company: companyAvailable },
        { icon: "calendar" as const, label: t("utilization"), value: summary.utilization === null ? "—" : `${summary.utilization}%`, sub: t("rentedDays", { rented: summary.rentedDays, available: summary.availableDays }), company: null },
      ]
    : [
    { icon: "coins" as const, label: t("monthShare"), value: formatMoney(summary.monthShareCents), sub: summary.nextSettlement ? t("nextSettlement", { date: formatDate(summary.nextSettlement.at) }) : summary.heldPendingCents > 0 ? t("heldPending") : t("noPending"), company: companySummary ? tm("companyTotal", { amount: formatMoney(companySummary.monthShareCents) }) : null },
    { icon: "list" as const, label: t("settledTotal"), value: formatMoney(summary.settledTotalCents), sub: null, company: null },
    { icon: "card" as const, label: t("available"), value: formatMoney(balances.availableCents), sub: balances.pendingCents > 0 ? t("pendingBalance", { amount: formatMoney(balances.pendingCents) }) : null, company: companyAvailable },
    { icon: "calendar" as const, label: t("utilization"), value: summary.utilization === null ? "—" : `${summary.utilization}%`, sub: t("rentedDays", { rented: summary.rentedDays, available: summary.availableDays }), company: null },
  ];
  const hero = active[0] ?? assets[0] ?? null;
  const strip = position && session.company ? <MemberStrip company={session.company.name} stakeCents={position.stakeCents} ratio={position.ratio} /> : null;

  if (assets.length === 0) {
    return (
      <>
        <PageIntro title={t("title")} subtitle={t(owner ? "owner.subtitle" : "subtitle")} />
        {strip}
        <section className="card flex flex-col items-center gap-3 px-6 py-14 text-center">
          <IconBadge name="car" size={10} />
          <p className="text-[15px] font-medium">{t("emptyTitle", { name: session.legalName })}</p>
          <p className="max-w-md text-[13px] text-muted">{session.memberId ? ta("empty") : t(owner ? "owner.emptyBody" : "emptyBody")}</p>
          {!session.memberId && (
            <Link href="/invest" className={`${goldPill} mt-2`}>
              {t(owner ? "owner.deliver" : "invest")}
            </Link>
          )}
        </section>
      </>
    );
  }

  return (
    <>
      <PageIntro
        title={t("title")}
        subtitle={t(owner ? "owner.subtitle" : "subtitle")}
        actions={
          <div className="flex items-center gap-2">
            <span className="hidden h-10 items-center rounded-xl bg-white px-4 text-[13px] font-medium hairline sm:inline-flex">{monthLabel(month, locale)}</span>
            {!session.memberId && (
              <Link href="/invest" className={whitePill}>
                {t(owner ? "owner.deliver" : "invest")}
              </Link>
            )}
            <Link href="/funds" className={goldPill}>
              {t("withdraw")}
            </Link>
          </div>
        }
      />
      {strip}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {stats.map((stat) => (
          <section key={stat.label} className="card p-5">
            <div className="flex items-start justify-between gap-3">
              <p className="text-[13px] text-muted">{stat.label}</p>
              <Icon name={stat.icon} size={18} className="text-gold" />
            </div>
            <p className="mt-2 text-[2rem] leading-tight font-semibold tracking-tight">{stat.value}</p>
            {stat.sub && (
              <p className="mt-2 flex items-center gap-1.5 text-[12px] text-muted">
                <Icon name="clock" size={13} />
                {stat.sub}
              </p>
            )}
            {stat.company && <p className="mt-1 text-[12px] text-muted">{stat.company}</p>}
          </section>
        ))}
      </div>
      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
        <section className="card min-w-0 p-6">
          <SectionHeading title={t("trend")} />
          <TrendChart points={points} labels={monthsBack(month, 6).map((item) => shortMonth(item, locale))} legend={{ settled: t("settled"), pending: t("pending") }} />
        </section>
        <section className="card flex min-w-0 flex-col p-6">
          <SectionHeading title={t("assetsTitle")} icon="car" />
          <dl className="grid grid-cols-3 divide-x divide-ink/[0.07] text-center">
            <div>
              <dd className="text-[1.5rem] font-semibold tracking-tight">{active.length}</dd>
              <dt className="text-[12px] text-muted">{t("operatingVehicles")}</dt>
            </div>
            <div>
              <dd className="text-[1.5rem] font-semibold tracking-tight">{owner ? owner.totalMiles.toLocaleString("en-US") : formatMoney(position ? position.stakeCents : balances.investedCents)}</dd>
              <dt className="text-[12px] text-muted">{owner ? t("owner.totalMiles") : position ? tm("stake") : t("capitalIn")}</dt>
            </div>
            <div>
              <dd className="text-[1.5rem] font-semibold tracking-tight">{owner ? formatMoney(owner.totalCents) : active.filter((asset) => asset.source === "VEHICLE").length}</dd>
              <dt className="text-[12px] text-muted">{t(owner ? "owner.totalFee" : "vehiclesIn")}</dt>
            </div>
          </dl>
          {hero && (
            <div className="relative mt-4 min-h-32 flex-1 overflow-hidden rounded-xl bg-[radial-gradient(120%_90%_at_50%_100%,#ece2cf_0%,#f7f3ec_50%,#fbfaf7_100%)]">
              <Image src={hero.cover} alt="" fill unoptimized sizes="30rem" className={hero.cover.startsWith("/portal/") ? "object-contain p-[6%]" : "object-cover"} />
            </div>
          )}
        </section>
      </div>
      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <section className="card min-w-0 p-6">
          <SectionHeading title={t("myVehicles")} href="/assets" more={t("viewAll")} />
          {active[0] && <AssetCard asset={active[0]} today={today} stats={summary.stats[active[0].id]} owner={owner ? { statement: owner.latest[active[0].id] ?? null } : undefined} ratio={position?.ratio} />}
        </section>
        <section className="card min-w-0 p-6">
          <SectionHeading title={t("activity")} href="/messages?status=notifications" more={t("viewAll")} icon="list" />
          {feed.length === 0 ? (
            <p className="text-[13px] text-muted">{t("noActivity")}</p>
          ) : (
            <ul className="divide-y divide-ink/[0.06]">
              {feed.map((item) => (
                <li key={item.id}>
                  <a href={item.href} className="flex items-start gap-3 py-2.5 text-[13px] hover:text-gold">
                    <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-gold" />
                    <span className="min-w-0 flex-1 leading-snug text-charcoal">{item.text}</span>
                    <span className="shrink-0 text-[11px] text-muted">{formatDateTime(item.at)}</span>
                  </a>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}
