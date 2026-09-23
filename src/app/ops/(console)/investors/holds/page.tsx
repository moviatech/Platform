import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/Badge";
import { BackLink } from "@/components/ops/BackLink";
import { PageHeader } from "@/components/ops/PageHeader";
import { ReleaseHoldForm } from "@/features/investor/HoldForms";
import { listActiveHolds } from "@/features/investor/holds";
import { can, requirePagePermission } from "@/lib/auth/staff";
import { formatDateTime, formatMoney } from "@/lib/utils/format";

export const metadata: Metadata = { title: "Settlement holds" };

export default async function HoldsPage() {
  const session = await requirePagePermission("investor.view");
  const [t, common, holds] = await Promise.all([getTranslations("investors.holds"), getTranslations("common"), listActiveHolds()]);
  const manage = can(session, "investor.manage");
  return (
    <>
      <BackLink href="/investors" />
      <PageHeader title={t("title")} />
      {holds.length === 0 ? (
        <div className="card px-6 py-14 text-center text-sm text-muted">{common("empty")}</div>
      ) : (
        <div className="card overflow-hidden">
          <ul className="divide-y divide-ink/[0.06]">
            {holds.map((hold) => (
              <li key={hold.id} className="flex flex-col gap-2 px-5 py-4 text-[13px] sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone="warning">{t(`scopes.${hold.scope}`)}</Badge>
                    {hold.investor && (
                      <Link href={`/investors/${hold.investor.id}`} className="font-medium hover:text-gold">
                        {hold.investor.legal_name} · {hold.investor.investor_number}
                      </Link>
                    )}
                    {hold.vehicle && <span className="font-medium">{hold.vehicle.fleet_number}</span>}
                    {hold.entry && (
                      <span className="font-medium">
                        {hold.entry.reservation?.number} · {formatMoney(hold.entry.amount_cents)}
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-charcoal">{hold.reason}</p>
                  <p className="text-[12px] text-muted">
                    {formatDateTime(hold.created_at)}
                    {hold.author?.display_name ? ` · ${hold.author.display_name}` : ""}
                  </p>
                </div>
                {manage && <ReleaseHoldForm id={hold.id} />}
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}
