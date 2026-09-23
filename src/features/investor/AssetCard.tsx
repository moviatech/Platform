import Image from "next/image";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Icon } from "@/features/portal/icons";
import { cn } from "@/lib/utils/cn";
import { formatMoney } from "@/lib/utils/format";
import type { AssetCard as Asset } from "./assets";
import { assetSteps } from "./assets";

export const liveTone: Record<string, string> = {
  AVAILABLE: "bg-status-available/12 text-status-available",
  RENTED: "bg-status-available/12 text-status-available",
  MAINTENANCE: "bg-status-limited/15 text-[#a87415]",
  ENDED: "bg-ink/5 text-charcoal",
};

export async function LiveBadge({ live }: { live: string }) {
  const t = await getTranslations("investor.assets.live");
  return (
    <span className={cn("inline-flex h-6 items-center gap-1.5 rounded-pill px-2.5 text-[11px] font-medium", liveTone[live])}>
      <span className="size-1.5 rounded-full bg-current" />
      {t(live)}
    </span>
  );
}

export async function AssetCard({ asset, today, stats }: { asset: Asset; today: string; stats?: { monthShareCents: number; utilization: number | null; settledCents: number } }) {
  const t = await getTranslations("investor.assets");
  const steps = assetSteps(asset, today);
  const stepLabels = asset.source === "VEHICLE" ? [t("steps.review"), t("steps.handover"), t("steps.operating")] : [t("steps.funds"), t("steps.purchase"), t("steps.delivery"), t("steps.operating")];
  const months = Math.max(0, Math.floor((Date.parse(today) - Date.parse(asset.effective_from)) / (30 * 86400000)));
  const metrics = [
    asset.source === "CAPITAL" ? { label: t("invested"), value: formatMoney(asset.cost_basis_cents) } : { label: t("vehicleInvested"), value: t("oneVehicle") },
    { label: t("monthShare"), value: stats ? formatMoney(stats.monthShareCents) : "—" },
    { label: t("utilization"), value: stats?.utilization === null || stats?.utilization === undefined ? "—" : `${stats.utilization}%` },
    { label: t("settled"), value: stats ? formatMoney(stats.settledCents) : "—" },
  ];
  return (
    <article className="card flex overflow-hidden">
      <Link href={`/assets/${asset.id}`} className="relative w-32 shrink-0 bg-[radial-gradient(120%_90%_at_50%_100%,#ece2cf_0%,#f7f3ec_50%,#fbfaf7_100%)] sm:w-44">
        <Image src={asset.cover} alt="" fill unoptimized sizes="12rem" className={asset.cover.startsWith("/portal/") ? "object-contain p-[8%]" : "object-cover"} />
        <span className="absolute top-2.5 left-2.5 rounded-pill bg-white/90 px-2 py-0.5 text-[10px] font-medium text-gold">{t(`source.${asset.source}`)}</span>
      </Link>
      <div className="min-w-0 flex-1 p-4 sm:p-5">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-[15px] font-semibold tracking-tight">{asset.className}</h3>
          <LiveBadge live={asset.live} />
        </div>
        <p className="text-[12px] text-muted">{asset.vehicle?.fleet_number}</p>
        <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 sm:grid-cols-4">
          {metrics.map((metric, index) => (
            <div key={metric.label} className={cn("sm:border-l sm:border-ink/[0.07] sm:pl-3", index === 0 && "sm:border-l-0 sm:pl-0")}>
              <dt className="text-[11px] text-muted">{metric.label}</dt>
              <dd className="text-[15px] font-semibold tracking-tight">{metric.value}</dd>
            </div>
          ))}
        </dl>
        <ol className="relative mt-4 flex justify-between px-5">
          <span aria-hidden="true" className="absolute top-2 right-7 left-7 h-px bg-ink/10" />
          <span aria-hidden="true" className="absolute top-2 left-7 h-px bg-gold" style={{ width: `calc((100% - 3.5rem) * ${Math.max(0, steps.lastIndexOf(true)) / Math.max(1, stepLabels.length - 1)})` }} />
          {stepLabels.map((label, index) => (
            <li key={label} className="relative flex w-0 flex-col items-center">
              <span className={cn("relative z-10 flex size-4 items-center justify-center rounded-full", steps[index] ? "bg-gold text-white" : "border border-ink/15 bg-white")}>{steps[index] && <Icon name="check" size={9} />}</span>
              <span className="mt-1 text-[10px] whitespace-nowrap text-charcoal">{label}</span>
            </li>
          ))}
        </ol>
        <div className="mt-3 flex items-center justify-between border-t border-ink/[0.06] pt-2.5 text-[12px]">
          <span className="text-muted">{asset.status === "ENDED" ? t("endedOn", { date: asset.effective_to ?? "" }) : t("operatingFor", { months })}</span>
          <Link href={`/assets/${asset.id}`} className="flex items-center gap-1 font-medium text-gold hover:text-gold-light">
            {t("details")}
            <Icon name="arrow" size={13} />
          </Link>
        </div>
      </div>
    </article>
  );
}
