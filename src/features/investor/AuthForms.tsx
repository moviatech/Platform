"use client";

import { useActionState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/Button";
import { FieldWrap, Input } from "@/components/ui/Field";
import { PhoneInput } from "@/components/ui/FormattedInput";
import { applyAsInvestor, requestInvestorPasswordReset, resendSignupCode, resetInvestorPassword, sendInvestorMfaCode, setInvestorPassword, signInInvestor, signUpInvestor, verifyInvestorMfaCode, verifySignupCode, type InvestorAuthState } from "./auth-actions";
import { Turnstile } from "./Turnstile";

function ErrorBox({ code }: { code?: InvestorAuthState["error"] }) {
  const t = useTranslations("investor.auth");
  if (!code) return null;
  return (
    <p className="rounded-xl bg-status-danger/8 px-3.5 py-2.5 text-[13px] text-status-danger" role="alert">
      {t(`errors.${code}`)}
    </p>
  );
}

export function InvestorLoginForm() {
  const t = useTranslations("investor.auth");
  const [state, action, pending] = useActionState<InvestorAuthState, FormData>(signInInvestor, {});
  return (
    <form action={action} className="flex flex-col gap-4">
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
      <div className="flex justify-end text-[13px]">
        <Link href="/forgot" className="text-muted hover:text-ink">
          {t("forgot")}
        </Link>
      </div>
    </form>
  );
}

export function InvestorSignUpForm() {
  const t = useTranslations("investor.auth");
  const [state, action, pending] = useActionState<InvestorAuthState, FormData>(signUpInvestor, {});
  return (
    <form action={action} className="flex flex-col gap-4">
      <FieldWrap label={t("legalName")} htmlFor="legalName" hint={t("legalNameHint")}>
        <Input id="legalName" name="legalName" autoComplete="name" required minLength={2} maxLength={120} autoFocus />
      </FieldWrap>
      <FieldWrap label={t("email")} htmlFor="email">
        <Input id="email" name="email" type="email" autoComplete="email" inputMode="email" required />
      </FieldWrap>
      <FieldWrap label={t("phone")} htmlFor="phone">
        <PhoneInput id="phone" name="phone" autoComplete="tel" required maxLength={40} placeholder="+1 (___) ___-____" />
      </FieldWrap>
      <FieldWrap label={t("password")} htmlFor="password" hint={t("passwordHint")}>
        <Input id="password" name="password" type="password" autoComplete="new-password" required minLength={8} maxLength={72} />
      </FieldWrap>
      <FieldWrap label={t("confirmPassword")} htmlFor="confirm">
        <Input id="confirm" name="confirm" type="password" autoComplete="new-password" required minLength={8} maxLength={72} />
      </FieldWrap>
      <Turnstile />
      <ErrorBox code={state.error} />
      {state.error === "account_exists" && (
        <Link href="/login" className="text-center text-[13px] text-ink underline decoration-gold/50 underline-offset-4">
          {t("signIn")}
        </Link>
      )}
      <Button type="submit" size="lg" disabled={pending} className="w-full">
        {pending ? t("sending") : t("create")}
      </Button>
    </form>
  );
}

export function SignupVerifyForm({ email }: { email: string }) {
  const t = useTranslations("investor.auth");
  const [state, action, pending] = useActionState<InvestorAuthState, FormData>(verifySignupCode, {});
  const [resend, resendAction, resending] = useActionState<InvestorAuthState, FormData>(resendSignupCode, {});
  return (
    <div className="flex flex-col gap-4">
      <form action={action} className="flex flex-col gap-4">
        <input type="hidden" name="email" value={email} />
        <FieldWrap label={t("code")} htmlFor="code" error={state.error ? t(`errors.${state.error}`) : undefined}>
          <Input id="code" name="code" inputMode="numeric" autoComplete="one-time-code" pattern="\d{6,10}" maxLength={10} required autoFocus aria-invalid={Boolean(state.error)} className="text-center text-lg tracking-[0.4em]" />
        </FieldWrap>
        <Button type="submit" size="lg" disabled={pending} className="w-full">
          {t("verify")}
        </Button>
      </form>
      <form action={resendAction} className="text-center">
        <input type="hidden" name="email" value={email} />
        <button type="submit" disabled={resending} className="text-[13px] text-muted hover:text-ink">
          {resend.sent ? t("codeResent") : t("resend")}
        </button>
        {resend.error && <ErrorBox code={resend.error} />}
      </form>
    </div>
  );
}

export function ApplyForm() {
  const t = useTranslations("investor.auth");
  const [state, action, pending] = useActionState<InvestorAuthState, FormData>(applyAsInvestor, {});
  return (
    <form action={action} className="flex flex-col gap-4">
      <FieldWrap label={t("legalName")} htmlFor="legalName" hint={t("legalNameHint")}>
        <Input id="legalName" name="legalName" autoComplete="name" required minLength={2} maxLength={120} autoFocus />
      </FieldWrap>
      <FieldWrap label={t("phone")} htmlFor="phone">
        <PhoneInput id="phone" name="phone" autoComplete="tel" required maxLength={40} placeholder="+1 (___) ___-____" />
      </FieldWrap>
      <ErrorBox code={state.error} />
      <Button type="submit" size="lg" disabled={pending} className="w-full">
        {t("apply")}
      </Button>
    </form>
  );
}

export function InvestorForgotForm() {
  const t = useTranslations("investor.auth");
  const [state, action, pending] = useActionState<InvestorAuthState, FormData>(requestInvestorPasswordReset, {});
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

export function InvestorResetForm() {
  const t = useTranslations("investor.auth");
  const [state, action, pending] = useActionState<InvestorAuthState, FormData>(resetInvestorPassword, {});
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

export function InvestorPasswordForm() {
  const t = useTranslations("investor.auth");
  const [state, action, pending] = useActionState<InvestorAuthState, FormData>(setInvestorPassword, {});
  return (
    <form action={action} className="flex flex-col gap-4">
      <FieldWrap label={t("newPassword")} htmlFor="newPassword">
        <Input id="newPassword" name="password" type="password" autoComplete="new-password" required minLength={8} maxLength={72} />
      </FieldWrap>
      <FieldWrap label={t("confirmPassword")} htmlFor="confirmNewPassword">
        <Input id="confirmNewPassword" name="confirm" type="password" autoComplete="new-password" required minLength={8} maxLength={72} />
      </FieldWrap>
      <ErrorBox code={state.error} />
      <div className="flex items-center gap-3">
        <Button type="submit" size="sm" variant="gold" disabled={pending}>
          {t("save")}
        </Button>
        {state.ok && <span className="text-[13px] text-status-available">{t("passwordSaved")}</span>}
      </div>
    </form>
  );
}

export function InvestorMfaChallenge({ email }: { email: string }) {
  const t = useTranslations("investor.mfa");
  const [sendState, sendAction, sending] = useActionState<InvestorAuthState, FormData>(sendInvestorMfaCode, {});
  const [verifyState, verifyAction, verifying] = useActionState<InvestorAuthState, FormData>(verifyInvestorMfaCode, {});
  const sent = sendState.sent || verifyState.sent;
  const errors = useTranslations("investor.auth");
  const error = sent ? verifyState.error : sendState.error;
  return (
    <div className="flex flex-col gap-5">
      <p className="text-sm text-muted">{t("lead", { email })}</p>
      {!sent ? (
        <form action={sendAction} className="flex flex-col gap-3">
          {error && (
            <p className="rounded-xl bg-status-danger/8 px-3.5 py-2.5 text-[13px] text-status-danger" role="alert">
              {errors(`errors.${error}`)}
            </p>
          )}
          <Button type="submit" size="lg" disabled={sending} className="w-full">
            {sending ? t("sending") : t("sendCode")}
          </Button>
        </form>
      ) : (
        <form action={verifyAction} className="flex flex-col gap-4">
          <FieldWrap label={t("code")} htmlFor="code">
            <Input id="code" name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]*" maxLength={6} required autoFocus className="text-center text-lg tracking-[0.4em]" />
          </FieldWrap>
          {error && (
            <p className="rounded-xl bg-status-danger/8 px-3.5 py-2.5 text-[13px] text-status-danger" role="alert">
              {errors(`errors.${error}`)}
            </p>
          )}
          <Button type="submit" size="lg" disabled={verifying} className="w-full">
            {t("verify")}
          </Button>
        </form>
      )}
      {sent && (
        <form action={sendAction} className="text-center">
          <button type="submit" className="text-[13px] text-muted hover:text-ink">
            {t("resend")}
          </button>
        </form>
      )}
    </div>
  );
}
