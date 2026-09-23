"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/Button";
import { chargeDamageClaim, type ClaimState } from "./actions";

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
