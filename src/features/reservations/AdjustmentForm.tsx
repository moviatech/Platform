"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/Button";
import { Input, Select } from "@/components/ui/Field";
import { formatMoney } from "@/lib/utils/format";
import type { ReservationActionState } from "./actions";
import { addAdjustment, removeAdjustment } from "./edit-actions";
import type { LineItem } from "./types";

export function AdjustmentForm({ reservationId, adjustments, editable }: { reservationId: string; adjustments: LineItem[]; editable: boolean }) {
  const t = useTranslations("reservations");
  const [state, action, pending] = useActionState<ReservationActionState, FormData>(addAdjustment, {});
  return (
    <div className="mt-3 flex flex-col gap-2 border-t border-ink/[0.08] pt-3">
      {adjustments.map((line) => (
        <div key={line.id} className="flex items-center justify-between gap-3 text-[13px]">
          <span className="min-w-0 truncate text-charcoal">{line.description}</span>
          <span className="flex shrink-0 items-center gap-2">
            <span className="tabular-nums">{formatMoney(line.amount_cents)}</span>
            {editable && (
              <form action={removeAdjustment}>
                <input type="hidden" name="reservationId" value={reservationId} />
                <input type="hidden" name="lineId" value={line.id} />
                <button type="submit" className="rounded-pill px-2 py-0.5 text-[11px] text-status-danger hover:bg-status-danger/10">
                  {t("edit.remove")}
                </button>
              </form>
            )}
          </span>
        </div>
      ))}
      {editable && (
        <form action={action} className="grid grid-cols-[6rem_minmax(0,1fr)_6rem_auto] items-center gap-2">
          <input type="hidden" name="reservationId" value={reservationId} />
          <Select name="kind" defaultValue="fee" className="h-9" aria-label={t("edit.kind")}>
            <option value="fee">{t("edit.fee")}</option>
            <option value="discount">{t("edit.discount")}</option>
          </Select>
          <Input name="description" required minLength={2} maxLength={120} placeholder={t("edit.description")} className="h-9" />
          <Input name="amount" inputMode="decimal" required placeholder={t("edit.amount")} className="h-9" />
          <Button type="submit" size="sm" variant="secondary" disabled={pending}>
            {t("edit.add")}
          </Button>
          {state.error && (
            <p className="col-span-4 text-[12px] text-status-danger" role="alert">
              {t.has(`errors.${state.error}`) ? t(`errors.${state.error}`) : state.error}
            </p>
          )}
        </form>
      )}
    </div>
  );
}
