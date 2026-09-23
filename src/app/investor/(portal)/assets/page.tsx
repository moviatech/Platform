import type { Metadata } from "next";
import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { zonedParts } from "@/features/booking/time";
import { AssetCard } from "@/features/investor/AssetCard";
import { listAssetCards } from "@/features/investor/assets";
import { listContributions } from "@/features/investor/contributions";
import { loadBalances } from "@/features/investor/ledger";
import { loadAssetStats } from "@/features/investor/stats";
import { IconBadge, PageIntro, goldPill } from "@/features/portal/ui";
import { requireInvestor } from "@/lib/auth/investor";
import { cn } from "@/lib/utils/cn";
import { formatDate, formatMoney } from "@/lib/utils/format";

export const metadata: Metadata = { title: "Assets" };

type Props = { searchParams: Promise<{ view?: string }> };

const statusTone: Record<string, string> = { REQUESTED: "bg-status-limited/15 text-[#a87415]", CONFIRMED: "bg-status-available/12 text-status-available", DECLINED: "bg-status-danger/10 text-status-danger", CANCELLED: "bg-ink/5 text-charcoal" };

export default async function AssetsPage({ searchParams }: Props) {
  const session = await requireInvestor();
  const { view } = await searchParams;
  const [t, locale, balances, assets, contributions] = await Promise.all([getTranslations("investor.assets"), getLocale(), loadBalances(session.investorId), listAssetCards(session.investorId, await getLocale()), listContributions(session.investorId)]);
  const today = zonedParts(new Date(), "America/Los_Angeles").date;
  const stats = await loadAssetStats(assets, today.slice(0, 7));
  const active = assets.filter((asset) => asset.status !== "ENDED");
  const filter = view === "capital" ? "CAPITAL" : view === "vehicle" ? "VEHICLE" : null;
  const shown = assets.filter((asset) => !filter || asset.source === filter);
  const tabs = [
    { key: "all", label: t("tabs.all", { count: assets.length }) },
    { key: "capital", label: t("tabs.capital", { count: assets.filter((asset) => asset.source === "CAPITAL").length }) },
    { key: "vehicle", label: t("tabs.vehicle", { count: assets.filter((asset) => asset.source === "VEHICLE").length }) },
  ];
  const cards = [
    { icon: "car" as const, label: t("operating"), value: t("vehicles", { count: active.length }) },
    { icon: "coins" as const, label: t("capital"), value: formatMoney(balances.investedCents) },
    { icon: "key" as const, label: t("hosted"), value: t("vehicles", { count: active.filter((asset) => asset.source === "VEHICLE").length }) },
  ];
  return (
    <>
      <PageIntro
        title={t("title")}
        subtitle={t("subtitle")}
        actions={
          <Link href="/invest" className={goldPill}>
            {t("invest")}
          </Link>
        }
      />
      <div className="grid gap-4 sm:grid-cols-3">
        {cards.map((card) => (
          <section key={card.label} className="card flex items-center gap-4 p-5">
            <IconBadge name={card.icon} size={10} />
            <div>
              <p className="text-[13px] text-muted">{card.label}</p>
              <p className="text-[1.5rem] leading-tight font-semibold tracking-tight">{card.value}</p>
            </div>
          </section>
        ))}
      </div>
      <div className="mt-6 flex gap-1 border-b border-ink/[0.07]">
        {tabs.map((tab) => (
          <Link key={tab.key} href={tab.key === "all" ? "/assets" : `/assets?view=${tab.key}`} className={cn("-mb-px border-b-2 px-4 py-2.5 text-[14px] font-medium", (view ?? "all") === tab.key ? "border-gold text-ink" : "border-transparent text-muted hover:text-ink")}>
            {tab.label}
          </Link>
        ))}
      </div>
      {shown.length === 0 ? (
        <section className="card mt-4 px-6 py-14 text-center text-[13px] text-muted">{t("empty")}</section>
      ) : (
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          {shown.map((asset) => (
            <AssetCard key={asset.id} asset={asset} today={today} stats={stats[asset.id]} />
          ))}
        </div>
      )}
      <section className="card mt-4 p-6">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-[17px] font-semibold tracking-tight">{t("records")}</h2>
          <span className="text-[12px] text-muted">{t("recordsNote")}</span>
        </div>
        {contributions.length === 0 ? (
          <p className="text-[13px] text-muted">{t("recordsEmpty")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[32rem] text-[13px]">
              <thead>
                <tr className="border-b border-ink/[0.07] text-left text-[11px] tracking-[0.12em] text-muted uppercase">
                  <th className="py-2 pr-4 font-medium">{t("columns.date")}</th>
                  <th className="py-2 pr-4 font-medium">{t("columns.kind")}</th>
                  <th className="py-2 pr-4 font-medium">{t("columns.asset")}</th>
                  <th className="py-2 pr-4 font-medium">{t("columns.amount")}</th>
                  <th className="py-2 font-medium">{t("columns.status")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink/[0.06]">
                {contributions.map((item) => (
                  <tr key={item.id}>
                    <td className="py-2.5 pr-4 text-muted">{formatDate(item.created_at)}</td>
                    <td className="py-2.5 pr-4">{t(`source.${item.kind}`)}</td>
                    <td className="py-2.5 pr-4">{item.kind === "VEHICLE" ? `${item.vehicle_payload.year ?? ""} ${item.vehicle_payload.model ?? ""}` : (locale === "zh" ? "资金" : "Capital")}</td>
                    <td className="py-2.5 pr-4 tabular-nums">{item.kind === "CAPITAL" ? formatMoney(item.received_cents ?? item.amount_cents) : t("oneVehicle")}</td>
                    <td className="py-2.5">
                      <span className={cn("inline-flex h-6 items-center rounded-pill px-2.5 text-[11px] font-medium", statusTone[item.status])}>{t(`contributionStatus.${item.status}`)}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
