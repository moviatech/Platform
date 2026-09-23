"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/Button";
import { registerPartnerAction, type TeslaActionState } from "./actions";

export function RegisterButton({ registered }: { registered: boolean }) {
  const t = useTranslations("tesla");
  const [state, action, pending] = useActionState<TeslaActionState, FormData>(registerPartnerAction, {});
  return (
    <form action={action} className="flex flex-wrap items-center gap-3">
      <Button type="submit" size="sm" variant={registered ? "secondary" : "primary"} disabled={pending}>
        {pending ? t("registering") : registered ? t("registerAgain") : t("register")}
      </Button>
      {state.ok && <span className="text-[13px] text-status-available">{t("registered")}</span>}
      {state.error && (
        <span className="text-[13px] text-status-danger" role="alert">
          {t.has(`errors.${state.error}`) ? t(`errors.${state.error}`) : `${t("errors.failed")} (${state.error})`}
          {state.detail && state.detail !== state.error ? ` · ${state.detail}` : ""}
        </span>
      )}
    </form>
  );
}
