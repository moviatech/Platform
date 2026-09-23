"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Field";
import { markWithdrawalPaid, revealBankAccount, reviewWithdrawal, type PayoutState } from "./ops-payout-actions";

function Feedback({ state }: { state: PayoutState }) {
  const t = useTranslations("investors.payouts");
  if (state.error) return <span className="text-[12px] text-status-danger">{t(`errors.${state.error}`)}</span>;
  return null;
}

export function ReviewWithdrawalForm({ id }: { id: string }) {
  const t = useTranslations("investors.payouts");
  const [state, action, pending] = useActionState<PayoutState, FormData>(reviewWithdrawal, {});
  if (state.ok) return <span className="text-[12px] text-status-available">{state.awaiting ? t("awaitingSecond") : t("approved")}</span>;
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="id" value={id} />
      <Input name="note" maxLength={1000} placeholder={t("note")} className="h-8 w-44 text-[12px]" />
      <Button type="submit" name="decision" value="approve" size="sm" variant="gold" className="h-8" disabled={pending}>
        {t("approve")}
      </Button>
      <Button type="submit" name="decision" value="decline" size="sm" variant="danger" className="h-8" disabled={pending} onClick={(event) => !confirm(t("confirmDecline")) && event.preventDefault()}>
        {t("decline")}
      </Button>
      <Feedback state={state} />
    </form>
  );
}

export function MarkPaidForm({ id }: { id: string }) {
  const t = useTranslations("investors.payouts");
  const [state, action, pending] = useActionState<PayoutState, FormData>(markWithdrawalPaid, {});
  if (state.ok) return <span className="text-[12px] text-status-available">{t("paid")}</span>;
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="id" value={id} />
      <Input name="reference" required maxLength={120} placeholder={t("reference")} className="h-8 w-48 text-[12px]" />
      <Button type="submit" size="sm" className="h-8" disabled={pending} onClick={(event) => !confirm(t("confirmPaid")) && event.preventDefault()}>
        {t("markPaid")}
      </Button>
      <Feedback state={state} />
    </form>
  );
}

export function RevealAccountForm({ id }: { id: string }) {
  const t = useTranslations("investors.payouts");
  const [state, action, pending] = useActionState<PayoutState, FormData>(revealBankAccount, {});
  if (state.ok) {
    return (
      <span className="font-mono text-[12px] text-ink">
        {t("routing")} {state.routing} · {t("accountNumber")} {state.account}
      </span>
    );
  }
  return (
    <form action={action} className="flex items-center gap-2">
      <input type="hidden" name="id" value={id} />
      <Button type="submit" size="sm" variant="secondary" className="h-8" disabled={pending}>
        {t("reveal")}
      </Button>
      <Feedback state={state} />
    </form>
  );
}
