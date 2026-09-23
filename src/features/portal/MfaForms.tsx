"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/Button";
import { FieldWrap, Input } from "@/components/ui/Field";
import { confirmMfaSetup, disableMfa, sendMfaCode, startMfaSetup, verifyMfaCode, type MfaState } from "./mfa-actions";

function ErrorBox({ code }: { code?: MfaState["error"] }) {
  const t = useTranslations("portal.mfa");
  if (!code) return null;
  return (
    <p className="rounded-xl bg-status-danger/8 px-3.5 py-2.5 text-[13px] text-status-danger" role="alert">
      {t(`errors.${code}`)}
    </p>
  );
}

export function MfaSettings({ enabled, email }: { enabled: boolean; email: string }) {
  const t = useTranslations("portal.mfa");
  const [start, startAction, starting] = useActionState<MfaState, FormData>(startMfaSetup, {});
  const [confirm, confirmAction, confirming] = useActionState<MfaState, FormData>(confirmMfaSetup, {});

  if (enabled || confirm.ok) {
    return (
      <form action={disableMfa} className="flex items-center justify-between gap-3 px-2 py-1 text-[13px]">
        <span className="text-charcoal">{t("enabledWith", { email })}</span>
        <Button type="submit" size="sm" variant="secondary">
          {t("disable")}
        </Button>
      </form>
    );
  }
  if (start.sent || confirm.sent) {
    return (
      <form action={confirmAction} className="flex flex-col gap-3 px-2 py-1">
        <p className="text-[13px] text-charcoal">{t("codeSentTo", { email })}</p>
        <FieldWrap label={t("code")} htmlFor="mfaCode">
          <Input id="mfaCode" name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]*" maxLength={6} required autoFocus className="max-w-40" />
        </FieldWrap>
        <ErrorBox code={confirm.error} />
        <div>
          <Button type="submit" size="sm" disabled={confirming}>
            {t("confirm")}
          </Button>
        </div>
      </form>
    );
  }
  return (
    <form action={startAction} className="flex flex-col gap-3 px-2 py-1">
      <p className="text-[13px] text-charcoal">{t("emailLead", { email })}</p>
      <ErrorBox code={start.error} />
      <div>
        <Button type="submit" size="sm" disabled={starting}>
          {starting ? t("sending") : t("sendCode")}
        </Button>
      </div>
    </form>
  );
}

export function MfaChallenge({ next, email }: { next: string; email: string }) {
  const t = useTranslations("portal.mfa");
  const [sendState, sendAction, sending] = useActionState<MfaState, FormData>(sendMfaCode, {});
  const [verifyState, verifyAction, verifying] = useActionState<MfaState, FormData>(verifyMfaCode, {});
  const sent = sendState.sent || verifyState.sent;
  return (
    <div className="flex flex-col gap-5">
      <p className="text-sm text-muted">{t("challengeLead", { email })}</p>
      {!sent ? (
        <form action={sendAction} className="flex flex-col gap-3">
          <input type="hidden" name="next" value={next} />
          <ErrorBox code={sendState.error} />
          <Button type="submit" size="lg" disabled={sending} className="w-full">
            {sending ? t("sending") : t("sendCode")}
          </Button>
        </form>
      ) : (
        <form action={verifyAction} className="flex flex-col gap-4">
          <input type="hidden" name="next" value={next} />
          <FieldWrap label={t("code")} htmlFor="code">
            <Input id="code" name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]*" maxLength={6} required autoFocus />
          </FieldWrap>
          <ErrorBox code={verifyState.error} />
          <Button type="submit" size="lg" disabled={verifying} className="w-full">
            {t("verify")}
          </Button>
        </form>
      )}
      {sent && (
        <form action={sendAction} className="text-center">
          <input type="hidden" name="next" value={next} />
          <button type="submit" className="text-[13px] text-muted hover:text-ink">
            {t("resend")}
          </button>
        </form>
      )}
    </div>
  );
}
