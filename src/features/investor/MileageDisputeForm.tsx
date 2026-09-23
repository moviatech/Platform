"use client";

import { useActionState, useState } from "react";
import { useTranslations } from "next-intl";
import { Icon } from "@/features/portal/icons";
import { cn } from "@/lib/utils/cn";
import { submitDispute, type DisputeState } from "./mileage-portal-actions";

export function MileageDisputeForm({ id, maxMiles }: { id: string; maxMiles: number }) {
  const t = useTranslations("investor.mileage");
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState<DisputeState, FormData>(submitDispute, {});
  if (state.ok) return <p className="text-[12px] text-status-available">{t("disputed")}</p>;
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="flex items-center gap-1 text-[12px] font-medium text-gold hover:text-gold-light">
        <Icon name="alert" size={13} />
        {t("dispute")}
      </button>
    );
  }
  const field = "h-9 rounded-lg border border-ink/15 bg-white px-3 text-[13px] focus:border-gold/60 focus:outline-none";
  return (
    <form action={action} className="mt-2 flex flex-col gap-2 rounded-xl bg-[#f7f4ee] p-3">
      <input type="hidden" name="id" value={id} />
      <div className="flex flex-wrap items-center gap-2">
        <input name="miles" type="number" inputMode="numeric" required min={1} max={maxMiles} placeholder={t("disputeMiles")} aria-label={t("disputeMiles")} className={cn(field, "w-36")} />
        <input name="note" required minLength={2} maxLength={1000} placeholder={t("disputeNote")} aria-label={t("disputeNote")} className={cn(field, "min-w-0 flex-1")} />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={pending} className="inline-flex h-9 items-center rounded-pill bg-gold px-4 text-[12px] font-medium text-white hover:bg-gold-light disabled:opacity-50">
          {t("submitDispute")}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="text-[12px] text-muted hover:text-ink">
          {t("cancel")}
        </button>
        <span className="text-[11px] text-muted">{t("disputeHint")}</span>
        {state.error && <span className="text-[12px] text-status-danger">{t(`errors.${state.error}`)}</span>}
      </div>
    </form>
  );
}
