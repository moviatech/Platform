"use client";

import { useActionState, useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/Button";
import { Textarea } from "@/components/ui/Field";
import { formatMoney } from "@/lib/utils/format";
import { consentDamage, disputeDamage, type DamageState } from "./damage-actions";

type Props = { claimId: string; number: string; amountCents: number; description: string | null };

export function DamageConsent({ claimId, number, amountCents, description }: Props) {
  const t = useTranslations("portal.trip.damage");
  const [consent, consentAction, consenting] = useActionState<DamageState, FormData>(consentDamage, {});
  const [dispute, disputeAction, disputing] = useActionState<DamageState, FormData>(disputeDamage, {});
  const [mode, setMode] = useState<"consent" | "dispute">("consent");
  if (consent.ok) return <p className="rounded-xl bg-status-available/10 px-4 py-3 text-sm">{consent.charged ? t("charged") : t("consented")}</p>;
  if (dispute.ok) return <p className="rounded-xl bg-status-info/10 px-4 py-3 text-sm">{t("disputed")}</p>;
  const error = consent.error ?? dispute.error;
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-charcoal">{t("intro", { amount: formatMoney(amountCents) })}</p>
      {description && <p className="rounded-xl bg-pearl px-3.5 py-2.5 text-[13px] whitespace-pre-wrap text-charcoal">{description}</p>}
      {mode === "consent" ? (
        <form action={consentAction} className="flex flex-col gap-3">
          <input type="hidden" name="claimId" value={claimId} />
          <input type="hidden" name="number" value={number} />
          <label className="flex items-start gap-2.5 text-[13px] text-charcoal">
            <input type="checkbox" name="agree" required className="mt-0.5 size-4 shrink-0 accent-[#b58b4b]" />
            {t("agree", { amount: formatMoney(amountCents) })}
          </label>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" size="sm" variant="gold" disabled={consenting}>
              {t("confirm")}
            </Button>
            <Button type="button" size="sm" variant="secondary" onClick={() => setMode("dispute")}>
              {t("disputeButton")}
            </Button>
          </div>
        </form>
      ) : (
        <form action={disputeAction} className="flex flex-col gap-3">
          <input type="hidden" name="claimId" value={claimId} />
          <input type="hidden" name="number" value={number} />
          <Textarea name="note" required maxLength={2000} placeholder={t("disputePlaceholder")} className="min-h-20" />
          <div className="flex flex-wrap gap-2">
            <Button type="submit" size="sm" variant="secondary" disabled={disputing}>
              {t("sendDispute")}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setMode("consent")}>
              {t("back")}
            </Button>
          </div>
        </form>
      )}
      {error && (
        <p className="text-[13px] text-status-danger" role="alert">
          {t.has(`errors.${error}`) ? t(`errors.${error}`) : error}
        </p>
      )}
    </div>
  );
}
