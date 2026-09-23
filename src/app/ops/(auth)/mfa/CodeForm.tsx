"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/Button";
import { FieldWrap, Input } from "@/components/ui/Field";
import { signOut, verifyMfa, type AuthState } from "@/features/auth/actions";

export function CodeForm({ factorId, label }: { factorId: string; label?: string }) {
  const t = useTranslations("auth");
  const common = useTranslations("common");
  const [state, action, pending] = useActionState<AuthState, FormData>(verifyMfa, {});

  return (
    <>
      <form action={action} className="mt-7 flex flex-col gap-4">
        <input type="hidden" name="factorId" value={factorId} />
        <FieldWrap label={label ?? t("mfaCode")} htmlFor="code" error={state.error ? t("errorCode") : undefined}>
          <Input
            id="code"
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="\d{6}"
            maxLength={6}
            required
            autoFocus
            aria-invalid={Boolean(state.error)}
            className="text-center text-lg tracking-[0.5em]"
          />
        </FieldWrap>
        <Button type="submit" size="lg" disabled={pending} className="w-full">
          {t("mfaVerify")}
        </Button>
      </form>
      <form action={signOut} className="mt-3">
        <Button type="submit" variant="ghost" size="sm" className="w-full text-muted">
          {common("signOut")}
        </Button>
      </form>
    </>
  );
}
