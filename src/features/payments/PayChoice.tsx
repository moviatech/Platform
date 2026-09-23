"use client";

import { useActionState, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/Button";
import { formatMoney } from "@/lib/utils/format";
import { payWithSavedCardAction, type PayState } from "@/features/portal/pay-actions";

type Props = { number: string; last4: string; amountCents: number; prepay: boolean; form: ReactNode };

export function PayChoice({ number, last4, amountCents, prepay, form }: Props) {
  const t = useTranslations("portal.pay");
  const [state, action, pending] = useActionState<PayState, FormData>(payWithSavedCardAction, {});
  const [other, setOther] = useState(false);
  if (other) {
    return (
      <div className="flex flex-col gap-4">
        {form}
        <button type="button" onClick={() => setOther(false)} className="text-center text-[13px] text-muted hover:text-ink">
          {t("useSaved", { last4 })}
        </button>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-4">
      <form action={action}>
        <input type="hidden" name="number" value={number} />
        <input type="hidden" name="prepay" value={prepay ? "1" : ""} />
        <Button type="submit" size="lg" disabled={pending} className="w-full">
          {pending ? t("processing") : t("payWithCard", { last4, amount: formatMoney(amountCents) })}
        </Button>
      </form>
      {state.error && (
        <p className="rounded-xl bg-status-danger/8 px-4 py-3 text-[13px] text-status-danger" role="alert">
          {t("errors.generic")}
        </p>
      )}
      <button type="button" onClick={() => setOther(true)} className="text-center text-[13px] text-muted hover:text-ink">
        {t("otherCard")}
      </button>
    </div>
  );
}
