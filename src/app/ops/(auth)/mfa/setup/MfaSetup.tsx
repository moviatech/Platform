"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/Button";
import { startEnrollment, type EnrollState } from "@/features/auth/actions";
import { CodeForm } from "../CodeForm";

export function MfaSetup() {
  const t = useTranslations("auth");
  const [state, start, pending] = useActionState<EnrollState>(startEnrollment, {});

  if (!state.factorId || !state.qr) {
    return (
      <form action={start} className="mt-7">
        {state.error && (
          <p className="mb-4 rounded-xl bg-status-danger/8 px-3.5 py-2.5 text-[13px] text-status-danger" role="alert">
            {t("errorUnavailable")}
          </p>
        )}
        <Button type="submit" size="lg" disabled={pending} className="w-full">
          {t("mfaStart")}
        </Button>
      </form>
    );
  }

  return (
    <div className="mt-6">
      <div className="flex justify-center rounded-2xl bg-pearl p-5">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={state.qr} alt="" width={184} height={184} className="size-[184px] rounded-lg bg-white p-2" />
      </div>
      <details className="mt-3 text-xs text-muted">
        <summary>{t("mfaSecret")}</summary>
        <code className="mt-2 block break-all rounded-lg bg-pearl px-3 py-2 font-mono text-[12px] text-ink">{state.secret}</code>
      </details>
      <CodeForm factorId={state.factorId} label={t("mfaConfirm")} />
    </div>
  );
}
