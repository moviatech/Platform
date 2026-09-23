"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/Button";
import { FieldWrap, Input } from "@/components/ui/Field";
import { signIn, type AuthState } from "@/features/auth/actions";

const errorKeys = {
  invalid: "errorInvalid",
  credentials: "errorCredentials",
  code: "errorCode",
  unavailable: "errorUnavailable",
  rate_limited: "errorRateLimited",
} as const;

export function LoginForm() {
  const t = useTranslations("auth");
  const [state, action, pending] = useActionState<AuthState, FormData>(signIn, {});

  return (
    <form action={action} className="mt-7 flex flex-col gap-4">
      <FieldWrap label={t("email")} htmlFor="email">
        <Input id="email" name="email" type="email" autoComplete="username" required autoFocus />
      </FieldWrap>
      <FieldWrap label={t("password")} htmlFor="password">
        <Input id="password" name="password" type="password" autoComplete="current-password" required minLength={8} />
      </FieldWrap>
      {state.error && (
        <p className="rounded-xl bg-status-danger/8 px-3.5 py-2.5 text-[13px] text-status-danger" role="alert">
          {t(errorKeys[state.error])}
        </p>
      )}
      <Button type="submit" size="lg" disabled={pending} className="mt-1 w-full">
        {pending ? t("signingIn") : t("signIn")}
      </Button>
    </form>
  );
}
