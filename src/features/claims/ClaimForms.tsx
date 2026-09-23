"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Field";
import { addDamageClaim, chargeDamageClaim, type ClaimState } from "./actions";

export function AddClaimForm({ reservationId }: { reservationId: string }) {
  const t = useTranslations("damage");
  const [state, action, pending] = useActionState<ClaimState, FormData>(addDamageClaim, {});
  return (
    <form action={action} className="grid grid-cols-[6rem_minmax(0,1fr)_auto] items-center gap-2">
      <input type="hidden" name="reservationId" value={reservationId} />
      <Input name="damageAmount" inputMode="decimal" required placeholder={t("amount")} aria-label={t("amount")} className="h-9 text-[13px]" />
      <Input name="damageDescription" required minLength={3} maxLength={2000} placeholder={t("description")} aria-label={t("description")} className="h-9 text-[13px]" />
      <Button type="submit" size="sm" variant="secondary" disabled={pending}>
        {t("add")}
      </Button>
      {state.ok && <span className="col-span-3 text-[12px] text-status-available">{t("added")}</span>}
      {state.error && <span className="col-span-3 text-[12px] text-status-danger">{t.has(`errors.${state.error}`) ? t(`errors.${state.error}`) : state.error}</span>}
    </form>
  );
}

export function ChargeClaimButton({ claimId }: { claimId: string }) {
  const t = useTranslations("damage");
  const p = useTranslations("payments");
  const [state, action, pending] = useActionState<ClaimState, FormData>(chargeDamageClaim, {});
  if (state.ok) return <p className="text-[12px] text-status-available">{state.pending ? p("pendingApproval") : t("charged")}</p>;
  return (
    <form action={action} className="flex items-center gap-2">
      <input type="hidden" name="claimId" value={claimId} />
      <Button type="submit" size="sm" disabled={pending}>
        {t("charge")}
      </Button>
      {state.error && <span className="text-[12px] text-status-danger">{p.has(`errors.${state.error}`) ? p(`errors.${state.error}`) : t.has(`errors.${state.error}`) ? t(`errors.${state.error}`) : state.error}</span>}
    </form>
  );
}
