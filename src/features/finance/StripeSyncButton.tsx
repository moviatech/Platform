"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/Button";
import { runStripeSync, type StripeSyncState } from "./stripe-actions";

export function StripeSyncButton({ full }: { full: boolean }) {
  const t = useTranslations("finance.stripe");
  const [state, action, pending] = useActionState<StripeSyncState, FormData>(runStripeSync, {});
  return (
    <form action={action} className="flex items-center gap-2">
      {full && <input type="hidden" name="full" value="1" />}
      <Button type="submit" size="sm" variant="secondary" disabled={pending}>
        {pending ? t("syncing") : t("sync")}
      </Button>
      {state.error && <span className="text-[13px] text-status-danger">{t(`errors.${state.error}`)}</span>}
      {state.ok && <span className="text-[13px] text-status-available">✓ {state.transactions}</span>}
    </form>
  );
}
