import Image from "next/image";
import { getTranslations } from "next-intl/server";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Field";
import { formatFullDateTime, formatMoney } from "@/lib/utils/format";
import { updateClaimStatus } from "./actions";
import { AddClaimForm, ChargeClaimButton } from "./ClaimForms";
import type { ClaimRow } from "./service";

const tone: Record<ClaimRow["status"], BadgeTone> = { PENDING_CONSENT: "warning", CONSENTED: "info", DISPUTED: "danger", CHARGED: "success", INSURANCE: "neutral", CLOSED: "neutral" };

export async function ClaimPanel({ claims, canCharge, canEdit, addTo }: { claims: ClaimRow[]; canCharge: boolean; canEdit: boolean; addTo?: string | null }) {
  const [t] = await Promise.all([getTranslations("damage")]);
  if (!claims.length && !addTo) return null;
  return (
    <section className="card p-6">
      <h2 className="mb-3 text-sm font-semibold">{t("title")}</h2>
      <ul className="flex flex-col gap-4">
        {claims.map((claim) => (
          <li key={claim.id} className="flex flex-col gap-2 text-[13px]">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold tabular-nums">{formatMoney(claim.amount_cents)}</span>
              <Badge tone={tone[claim.status]}>{t(`status.${claim.status}`)}</Badge>
              <span className="text-muted">{formatFullDateTime(claim.created_at)}</span>
            </div>
            {claim.description && <p className="whitespace-pre-wrap text-charcoal">{claim.description}</p>}
            {claim.consent_at && <p className="text-[12px] text-muted">{t("consentedAt", { at: formatFullDateTime(claim.consent_at) })}</p>}
            {claim.consent_method === "ONSITE" && (
              <details className="text-[12px] text-muted">
                <summary className="cursor-pointer">{t("onsite", { name: claim.consent_name ?? "" })}</summary>
                {claim.consent_signature && (
                  <span className="mt-1.5 block w-56 overflow-hidden rounded-lg border border-ink/10 bg-white">
                    <Image src={claim.consent_signature} alt="" width={448} height={160} unoptimized className="block h-auto w-full" />
                  </span>
                )}
              </details>
            )}
            {claim.dispute_note && <p className="rounded-xl bg-status-danger/8 px-3 py-2 text-[12px] whitespace-pre-wrap">{claim.dispute_note}</p>}
            {claim.staff_note && <p className="text-[12px] text-muted">{claim.staff_note}</p>}
            {claim.status === "CONSENTED" && canCharge && <ChargeClaimButton claimId={claim.id} />}
            {!["CHARGED", "CLOSED"].includes(claim.status) && canEdit && (
              <form action={updateClaimStatus} className="flex flex-wrap items-center gap-2">
                <input type="hidden" name="claimId" value={claim.id} />
                <Input name="note" maxLength={500} placeholder={t("note")} className="h-8 w-44 text-[13px]" />
                <Button type="submit" name="status" value="INSURANCE" size="sm" variant="secondary">
                  {t("toInsurance")}
                </Button>
                <Button type="submit" name="status" value="CLOSED" size="sm" variant="ghost">
                  {t("close")}
                </Button>
              </form>
            )}
          </li>
        ))}
      </ul>
      {addTo && (
        <div className={claims.length ? "mt-4 border-t border-ink/[0.08] pt-4" : ""}>
          <AddClaimForm reservationId={addTo} />
        </div>
      )}
    </section>
  );
}
