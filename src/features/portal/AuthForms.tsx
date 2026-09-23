"use client";

import { useActionState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/Button";
import { FieldWrap, Input } from "@/components/ui/Field";
import { withNext } from "@/lib/auth/next-url";
import { requestLoginCode, requestPasswordReset, resetPassword, setPassword, signInWithPassword, signUp, verifyLoginCode, type PortalAuthState } from "./auth-actions";

function ErrorBox({ code }: { code?: PortalAuthState["error"] }) {
  const t = useTranslations("portal.auth");
  if (!code) return null;
  return (
    <p className="rounded-xl bg-status-danger/8 px-3.5 py-2.5 text-[13px] text-status-danger" role="alert">
      {t(`errors.${code}`)}
    </p>
  );
}

export function PasswordLoginForm({ next = "/" }: { next?: string }) {
  const t = useTranslations("portal.auth");
  const [state, action, pending] = useActionState<PortalAuthState, FormData>(signInWithPassword, {});
  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="next" value={next} />
      <FieldWrap label={t("email")} htmlFor="email">
        <Input id="email" name="email" type="email" autoComplete="email" inputMode="email" required autoFocus />
      </FieldWrap>
      <FieldWrap label={t("password")} htmlFor="password">
        <Input id="password" name="password" type="password" autoComplete="current-password" required />
      </FieldWrap>
      <ErrorBox code={state.error} />
      <Button type="submit" size="lg" disabled={pending} className="w-full">
        {t("signIn")}
      </Button>
      <div className="flex justify-between text-[13px]">
        <Link href="/forgot" className="text-muted hover:text-ink">
          {t("forgot")}
        </Link>
        <Link href={withNext("/login/code", next)} className="text-muted hover:text-ink">
          {t("codeLogin")}
        </Link>
      </div>
    </form>
  );
}

export function CodeRequestForm({ next = "/" }: { next?: string }) {
  const t = useTranslations("portal.auth");
  const [state, action, pending] = useActionState<PortalAuthState, FormData>(requestLoginCode, {});
  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="next" value={next} />
      <FieldWrap label={t("email")} htmlFor="email">
        <Input id="email" name="email" type="email" autoComplete="email" inputMode="email" required autoFocus />
      </FieldWrap>
      <ErrorBox code={state.error} />
      <Button type="submit" size="lg" disabled={pending} className="w-full">
        {pending ? t("sending") : t("sendCode")}
      </Button>
    </form>
  );
}

export function VerifyForm({ email, next = "/" }: { email: string; next?: string }) {
  const t = useTranslations("portal.auth");
  const [state, action, pending] = useActionState<PortalAuthState, FormData>(verifyLoginCode, {});
  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="email" value={email} />
      <input type="hidden" name="next" value={next} />
      <FieldWrap label={t("code")} htmlFor="code" error={state.error ? t("errors.code") : undefined}>
        <Input id="code" name="code" inputMode="numeric" autoComplete="one-time-code" pattern="\d{6,10}" maxLength={10} required autoFocus aria-invalid={Boolean(state.error)} className="text-center text-lg tracking-[0.4em]" />
      </FieldWrap>
      <Button type="submit" size="lg" disabled={pending} className="w-full">
        {t("signIn")}
      </Button>
      <Link href={withNext("/login/code", next)} className="text-center text-[13px] text-muted hover:text-ink">
        {t("resend")}
      </Link>
    </form>
  );
}

export function SignUpForm({ next = "/" }: { next?: string }) {
  const t = useTranslations("portal.auth");
  const [state, action, pending] = useActionState<PortalAuthState, FormData>(signUp, {});
  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="next" value={next} />
      <FieldWrap label={t("email")} htmlFor="email">
        <Input id="email" name="email" type="email" autoComplete="email" inputMode="email" required autoFocus />
      </FieldWrap>
      <FieldWrap label={t("password")} htmlFor="password" hint={t("passwordHint")}>
        <Input id="password" name="password" type="password" autoComplete="new-password" required minLength={8} maxLength={72} />
      </FieldWrap>
      <FieldWrap label={t("confirmPassword")} htmlFor="confirm">
        <Input id="confirm" name="confirm" type="password" autoComplete="new-password" required minLength={8} maxLength={72} />
      </FieldWrap>
      <ErrorBox code={state.error} />
      <Button type="submit" size="lg" disabled={pending} className="w-full">
        {pending ? t("sending") : t("create")}
      </Button>
    </form>
  );
}

export function ForgotForm() {
  const t = useTranslations("portal.auth");
  const [state, action, pending] = useActionState<PortalAuthState, FormData>(requestPasswordReset, {});
  return (
    <form action={action} className="flex flex-col gap-4">
      <FieldWrap label={t("email")} htmlFor="email">
        <Input id="email" name="email" type="email" autoComplete="email" inputMode="email" required autoFocus />
      </FieldWrap>
      <ErrorBox code={state.error} />
      <Button type="submit" size="lg" disabled={pending} className="w-full">
        {pending ? t("sending") : t("sendReset")}
      </Button>
    </form>
  );
}

export function ResetForm() {
  const t = useTranslations("portal.auth");
  const [state, action, pending] = useActionState<PortalAuthState, FormData>(resetPassword, {});
  return (
    <form action={action} className="flex flex-col gap-4">
      <FieldWrap label={t("newPassword")} htmlFor="password" hint={t("passwordHint")}>
        <Input id="password" name="password" type="password" autoComplete="new-password" required minLength={8} maxLength={72} autoFocus />
      </FieldWrap>
      <FieldWrap label={t("confirmPassword")} htmlFor="confirm">
        <Input id="confirm" name="confirm" type="password" autoComplete="new-password" required minLength={8} maxLength={72} />
      </FieldWrap>
      <ErrorBox code={state.error} />
      <Button type="submit" size="lg" disabled={pending} className="w-full">
        {t("save")}
      </Button>
    </form>
  );
}

export function PasswordForm() {
  const t = useTranslations("portal.profile");
  const [state, action, pending] = useActionState<PortalAuthState, FormData>(setPassword, {});
  return (
    <form action={action} className="flex flex-col gap-4">
      <FieldWrap label={t("newPassword")} htmlFor="newPassword">
        <Input id="newPassword" name="password" type="password" autoComplete="new-password" required minLength={8} maxLength={72} />
      </FieldWrap>
      <FieldWrap label={t("confirmPassword")} htmlFor="confirmNewPassword">
        <Input id="confirmNewPassword" name="confirm" type="password" autoComplete="new-password" required minLength={8} maxLength={72} />
      </FieldWrap>
      {state.error && (
        <p className="rounded-xl bg-status-danger/8 px-3.5 py-2.5 text-[13px] text-status-danger" role="alert">
          {t.has(`errors.${state.error}`) ? t(`errors.${state.error}`) : state.error}
        </p>
      )}
      <div className="flex items-center gap-3">
        <Button type="submit" size="sm" variant="gold" disabled={pending}>
          {t("savePassword")}
        </Button>
        {state.ok && <span className="text-[13px] text-status-available">{t("passwordSaved")}</span>}
      </div>
    </form>
  );
}
