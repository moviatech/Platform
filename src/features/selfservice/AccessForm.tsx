"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/Button";
import { Input, Textarea } from "@/components/ui/Field";
import { saveSelfServiceAccessAction, type AccessState } from "./actions";

type Props = { reservationId: string; link: string; note: string };

export function AccessForm({ reservationId, link, note }: Props) {
  const t = useTranslations("selfService");
  const [state, action, pending] = useActionState<AccessState, FormData>(saveSelfServiceAccessAction, {});
  return (
    <form action={action} className="mt-4 flex flex-col gap-2 border-t border-ink/[0.08] pt-4">
      <input type="hidden" name="reservationId" value={reservationId} />
      <Input name="link" type="url" defaultValue={link} placeholder={t("linkPlaceholder")} maxLength={500} className="h-9 text-[13px]" />
      <Textarea name="note" defaultValue={note} placeholder={t("accessNotePlaceholder")} maxLength={1000} className="min-h-14 text-[13px]" />
      <div className="flex items-center gap-3">
        <Button type="submit" size="sm" variant="secondary" disabled={pending}>
          {t("saveAccess")}
        </Button>
        {state.ok && !pending && <span className="text-xs font-medium text-status-available">{t("accessSaved")}</span>}
        {state.error && !pending && <span className="text-xs text-status-danger">{t("accessError")}</span>}
      </div>
    </form>
  );
}
