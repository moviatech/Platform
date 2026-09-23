"use client";

import { useActionState, useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/Button";
import { FieldWrap, Textarea } from "@/components/ui/Field";
import { saveSpecialTerms, type SpecialTermsState } from "./special-terms-actions";
import { specialTermsMax } from "./types";

export function SpecialTermsForm({ reservationId, zh, en }: { reservationId: string; zh: string; en: string }) {
  const t = useTranslations("reservations");
  const common = useTranslations("common");
  const [state, action, pending] = useActionState<SpecialTermsState, FormData>(saveSpecialTerms, {});
  const [text, setText] = useState({ zh, en });
  const count = (value: string) => `${value.length.toLocaleString("en-US")} / ${specialTermsMax.toLocaleString("en-US")}`;

  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="reservationId" value={reservationId} />
      <div className="grid gap-3 sm:grid-cols-2">
        <FieldWrap label={t("specialTerms.zh")} htmlFor="specialTermsZh" hint={count(text.zh)}>
          <Textarea id="specialTermsZh" name="zh" rows={8} maxLength={specialTermsMax} value={text.zh} onChange={(event) => setText({ ...text, zh: event.target.value })} lang="zh" />
        </FieldWrap>
        <FieldWrap label={t("specialTerms.en")} htmlFor="specialTermsEn" hint={count(text.en)}>
          <Textarea id="specialTermsEn" name="en" rows={8} maxLength={specialTermsMax} value={text.en} onChange={(event) => setText({ ...text, en: event.target.value })} lang="en" />
        </FieldWrap>
      </div>
      <div className="flex items-center gap-3">
        <Button type="submit" size="sm" variant="secondary" disabled={pending}>
          {common("save")}
        </Button>
        {state.ok && (
          <span key={state.at} className="text-[12px] text-status-available" role="status">
            {t("specialTerms.saved")}
          </span>
        )}
        {state.error && (
          <span className="text-[12px] text-status-danger" role="alert">
            {t.has(`errors.${state.error}`) ? t(`errors.${state.error}`) : t("errors.failed")}
          </span>
        )}
      </div>
    </form>
  );
}
