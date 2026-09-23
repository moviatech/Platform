"use client";

import { useActionState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/Button";
import { FieldWrap, Input } from "@/components/ui/Field";
import { Icon } from "@/features/portal/icons";
import { sendStepUpCode, verifyStepUpCode, type StepUpState } from "./step-up-actions";

export function StepUpGate({ verified, email, children }: { verified: boolean; email: string; children: ReactNode }) {
  const t = useTranslations("investor.stepUp");
  const router = useRouter();
  const [sendState, sendAction, sending] = useActionState<StepUpState, FormData>(sendStepUpCode, {});
  const [verifyState, verifyAction, verifying] = useActionState<StepUpState, FormData>(
    async (state, form) => {
      const result = await verifyStepUpCode(state, form);
      if (result.ok) router.refresh();
      return result;
    },
    {},
  );
  if (verified || verifyState.ok) return <>{children}</>;
  const sent = sendState.sent || verifyState.sent;
  const error = sent ? verifyState.error : sendState.error;
  return (
    <div className="rounded-xl bg-[#f7f4ee] p-5">
      <p className="flex items-center gap-2 text-[13px] font-semibold">
        <Icon name="shield" size={16} className="text-gold" />
        {t("title")}
      </p>
      <p className="mt-1 text-[12px] text-muted">{t("lead", { email })}</p>
      {!sent ? (
        <form action={sendAction} className="mt-3">
          <Button type="submit" size="sm" disabled={sending}>
            {sending ? t("sending") : t("send")}
          </Button>
        </form>
      ) : (
        <form action={verifyAction} className="mt-3 flex flex-wrap items-end gap-3">
          <FieldWrap label={t("code")} htmlFor="stepUpCode" className="w-40">
            <Input id="stepUpCode" name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]*" maxLength={6} required autoFocus className="text-center tracking-[0.3em]" />
          </FieldWrap>
          <Button type="submit" size="md" disabled={verifying}>
            {t("verify")}
          </Button>
          <button type="submit" formAction={sendAction} className="text-[12px] text-muted hover:text-ink">
            {t("resend")}
          </button>
        </form>
      )}
      {error && (
        <p className="mt-2 text-[12px] text-status-danger" role="alert">
          {t(`errors.${error}`)}
        </p>
      )}
    </div>
  );
}
