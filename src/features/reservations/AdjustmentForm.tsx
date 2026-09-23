"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/Button";
import { Input, Select } from "@/components/ui/Field";
import type { ReservationActionState } from "./actions";
import { addAdjustment } from "./edit-actions";

export function AdjustmentForm({ reservationId }: { reservationId: string }) {
  const t = useTranslations("reservations");
  const [state, action, pending] = useActionState<ReservationActionState, FormData>(addAdjustment, {});
  return (
    <div className="mt-3 flex flex-col gap-2 border-t border-ink/[0.08] pt-3">
      <form action={action} className="flex flex-col gap-2">
          <input type="hidden" name="reservationId" value={reservationId} />
          <div className="grid grid-cols-[6rem_minmax(0,1fr)_auto] items-center gap-2">
            <Select name="kind" defaultValue="fee" className="h-9" aria-label={t("edit.kind")}>
              <option value="fee">{t("edit.fee")}</option>
              <option value="discount">{t("edit.discount")}</option>
            </Select>
            <Input name="amount" inputMode="decimal" required placeholder={t("edit.amount")} className="h-9" />
            <Button type="submit" size="sm" variant="secondary" disabled={pending}>
              {t("edit.add")}
            </Button>
          </div>
          <Input name="description" required minLength={2} maxLength={120} placeholder={t("edit.description")} className="h-9 w-full" />
          {state.error && (
            <p className="text-[12px] text-status-danger" role="alert">
              {t.has(`errors.${state.error}`) ? t(`errors.${state.error}`) : state.error}
            </p>
          )}
          {state.pending && <p className="col-span-4 text-[12px] text-status-available">{t("edit.pendingApproval")}</p>}
      </form>
    </div>
  );
}
