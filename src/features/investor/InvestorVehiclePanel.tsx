import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/Badge";
import { withBack } from "@/components/ops/BackLink";
import { formatMoney } from "@/lib/utils/format";
import { getVehicleAllocation } from "./contributions";
import { PlaceHoldForm, ReleaseHoldForm } from "./HoldForms";
import { listActiveHolds } from "./holds";

export async function InvestorVehiclePanel({ vehicleId, manage }: { vehicleId: string; manage: boolean }) {
  const [t, h, allocation, holds] = await Promise.all([getTranslations("investors.vehiclePanel"), getTranslations("investors.holds"), getVehicleAllocation(vehicleId), listActiveHolds()]);
  const hold = holds.find((item) => item.scope === "VEHICLE" && item.vehicle_id === vehicleId) ?? null;
  return (
    <section className="card p-6">
      <h2 className="text-sm font-semibold">{t("title")}</h2>
      {!allocation ? (
        <p className="mt-3 text-[13px] text-muted">{t("movia")}</p>
      ) : (
        <dl className="mt-3 grid gap-2 text-[13px]">
          <div className="flex items-center justify-between gap-3">
            <dt className="text-muted">{t("investor")}</dt>
            <dd>
              <Link href={withBack(`/investors/${allocation.investor_id}`, `/fleet/${vehicleId}`)} className="font-medium hover:text-gold">
                {allocation.investor?.legal_name} · {allocation.investor?.investor_number}
              </Link>
            </dd>
          </div>
          <div className="flex items-center justify-between gap-3">
            <dt className="text-muted">{t("source")}</dt>
            <dd>
              <Badge tone={allocation.source === "CAPITAL" ? "gold" : "info"}>{t(`sources.${allocation.source}`)}</Badge>
            </dd>
          </div>
          {allocation.source === "CAPITAL" && (
            <div className="flex items-center justify-between gap-3">
              <dt className="text-muted">{t("costBasis")}</dt>
              <dd className="tabular-nums">{formatMoney(allocation.cost_basis_cents)}</dd>
            </div>
          )}
          <div className="flex items-center justify-between gap-3">
            <dt className="text-muted">{t("revenueShare")}</dt>
            <dd>{allocation.revenue_share_bps / 100}%</dd>
          </div>
          <div className="flex items-center justify-between gap-3">
            <dt className="text-muted">{t("since")}</dt>
            <dd>{allocation.effective_from}</dd>
          </div>
          <div className="flex items-center justify-between gap-3">
            <dt className="text-muted">{t("status")}</dt>
            <dd>
              <Badge tone={allocation.status === "ACTIVE" ? "success" : "warning"}>{t(`statuses.${allocation.status}`)}</Badge>
            </dd>
          </div>
        </dl>
      )}
      {allocation && (
        <div className="mt-4 border-t border-ink/[0.06] pt-4 text-[13px]">
          {hold ? (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-status-limited/[0.08] px-3.5 py-2.5">
              <span>
                <Badge tone="warning">{h("heldTag")}</Badge>
                <span className="ml-2 text-charcoal">{hold.reason}</span>
              </span>
              {manage && <ReleaseHoldForm id={hold.id} />}
            </div>
          ) : manage ? (
            <PlaceHoldForm scope="VEHICLE" target={vehicleId} compact />
          ) : null}
        </div>
      )}
    </section>
  );
}
