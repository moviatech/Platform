"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/Button";
import { FieldWrap, Input } from "@/components/ui/Field";
import { changeStaffPassword, type PasswordState } from "./actions";

export function PasswordForm() {
  const t = useTranslations("auth");
  const common = useTranslations("common");
  const [state, action, pending] = useActionState<PasswordState, FormData>(changeStaffPassword, {});

  return (
    <form action={action} className="flex max-w-sm flex-col gap-4">
      <FieldWrap label={t("currentPassword")} htmlFor="current">
        <Input id="current" name="current" type="password" required maxLength={200} autoComplete="current-password" />
      </FieldWrap>
      <FieldWrap label={t("newPassword")} htmlFor="password">
        <Input id="password" name="password" type="password" required minLength={8} maxLength={72} autoComplete="new-password" />
      </FieldWrap>
      <FieldWrap label={t("confirmPassword")} htmlFor="confirm">
        <Input id="confirm" name="confirm" type="password" required minLength={8} maxLength={72} autoComplete="new-password" />
      </FieldWrap>
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {common("save")}
        </Button>
        {state.ok && <span className="text-[13px] text-status-available">{t("passwordSaved")}</span>}
        {state.error && (
          <span className="text-[13px] text-status-danger" role="alert">
            {t(`passwordErrors.${state.error}`)}
          </span>
        )}
      </div>
    </form>
  );
}
