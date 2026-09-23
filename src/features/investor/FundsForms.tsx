"use client";

import { useActionState, useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/Button";
import { FieldWrap, Input, Select } from "@/components/ui/Field";
import { formatMoneyInput, MoneyInput } from "@/components/ui/FormattedInput";
import { Icon } from "@/features/portal/icons";
import { addBankAccount, removeBankAccount, type BankState } from "./bank-actions";
import { cancelWithdrawal, requestWithdrawal, type WithdrawalState } from "./withdrawal-actions";

type Account = { id: string; bank_name: string; last4: string; account_type: string; usable_after: string };

export function WithdrawalForm({ accounts, availableCents, minCents, now }: { accounts: Account[]; availableCents: number; minCents: number; now: number }) {
  const t = useTranslations("investor.funds");
  const [state, action, pending] = useActionState<WithdrawalState, FormData>(requestWithdrawal, {});
  const [amount, setAmount] = useState("");
  const usable = accounts.filter((account) => Date.parse(account.usable_after) <= now);
  const parsed = Math.round(Number(amount.replace(/[,$\s]/g, "")) * 100) || 0;
  const remaining = availableCents - parsed;
  const money = (cents: number) => (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: Number.isInteger(cents / 100) ? 0 : 2 });
  return (
    <form action={action} className="flex flex-col gap-4">
      <FieldWrap label={t("account")} htmlFor="bankAccountId">
        <Select id="bankAccountId" name="bankAccountId" required defaultValue={usable[0]?.id ?? ""} disabled={usable.length === 0}>
          {usable.length === 0 && <option value="">{t("noUsableAccount")}</option>}
          {usable.map((account) => (
            <option key={account.id} value={account.id}>
              {account.bank_name} •••• {account.last4}
            </option>
          ))}
        </Select>
      </FieldWrap>
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <label htmlFor="amount" className="text-xs font-medium tracking-wide text-charcoal">
            {t("amount")}
          </label>
          <button type="button" onClick={() => setAmount(formatMoneyInput((availableCents / 100).toFixed(2)))} className="text-[12px] text-gold hover:text-gold-light">
            {t("withdrawAll")}
          </button>
        </div>
        <MoneyInput id="amount" name="amount" required value={amount} onValueChange={setAmount} placeholder="$" className="text-lg" />
        <p className="text-xs text-muted">{parsed > 0 ? t("remaining", { amount: money(Math.max(0, remaining)) }) : t("min", { amount: money(minCents) })}</p>
      </div>
      {state.error && (
        <p className="rounded-xl bg-status-danger/8 px-3.5 py-2.5 text-[13px] text-status-danger" role="alert">
          {t(`errors.${state.error}`)}
        </p>
      )}
      <Button type="submit" size="lg" disabled={pending || usable.length === 0 || availableCents <= 0} className="w-full">
        {t("submit")}
      </Button>
      <p className="flex items-center justify-center gap-1.5 text-[12px] text-muted">
        <Icon name="help" size={13} />
        {t("timing")}
      </p>
    </form>
  );
}

export function CancelWithdrawalButton({ id }: { id: string }) {
  const t = useTranslations("investor.funds");
  const [state, action, pending] = useActionState<WithdrawalState, FormData>(cancelWithdrawal, {});
  if (state.ok) return null;
  return (
    <form action={action}>
      <input type="hidden" name="id" value={id} />
      <button type="submit" disabled={pending} className="text-[12px] text-muted hover:text-status-danger" onClick={(event) => !confirm(t("confirmCancel")) && event.preventDefault()}>
        {t("cancel")}
      </button>
      {state.error && <span className="ml-2 text-[12px] text-status-danger">{t(`errors.${state.error}`)}</span>}
    </form>
  );
}

export function BankAccountForm() {
  const t = useTranslations("investor.funds.accounts");
  const [state, action, pending] = useActionState<BankState, FormData>(addBankAccount, {});
  if (state.ok) return <p className="rounded-xl bg-status-available/10 px-4 py-3 text-[13px]">{t("added")}</p>;
  return (
    <form action={action} className="grid gap-4 sm:grid-cols-2">
      <FieldWrap label={t("holder")} htmlFor="holderName">
        <Input id="holderName" name="holderName" required minLength={2} maxLength={120} autoComplete="name" />
      </FieldWrap>
      <FieldWrap label={t("bank")} htmlFor="bankName">
        <Input id="bankName" name="bankName" required minLength={2} maxLength={120} />
      </FieldWrap>
      <FieldWrap label={t("type")} htmlFor="accountType">
        <Select id="accountType" name="accountType" defaultValue="CHECKING">
          <option value="CHECKING">{t("checking")}</option>
          <option value="SAVINGS">{t("savings")}</option>
        </Select>
      </FieldWrap>
      <FieldWrap label={t("routing")} htmlFor="routing">
        <Input id="routing" name="routing" inputMode="numeric" required pattern="\d{9}" maxLength={9} autoComplete="off" />
      </FieldWrap>
      <FieldWrap label={t("number")} htmlFor="account" className="sm:col-span-2">
        <Input id="account" name="account" inputMode="numeric" required pattern="\d{4,17}" maxLength={17} autoComplete="off" />
      </FieldWrap>
      {state.error && (
        <p className="rounded-xl bg-status-danger/8 px-3.5 py-2.5 text-[13px] text-status-danger sm:col-span-2" role="alert">
          {t(`errors.${state.error}`)}
        </p>
      )}
      <div className="sm:col-span-2">
        <Button type="submit" disabled={pending}>
          {t("add")}
        </Button>
      </div>
    </form>
  );
}

export function RemoveAccountButton({ id }: { id: string }) {
  const t = useTranslations("investor.funds.accounts");
  const [state, action, pending] = useActionState<BankState, FormData>(removeBankAccount, {});
  if (state.ok) return null;
  return (
    <form action={action} className="flex items-center gap-2">
      <input type="hidden" name="id" value={id} />
      <button type="submit" disabled={pending} className="text-[12px] text-muted hover:text-status-danger" onClick={(event) => !confirm(t("confirmRemove")) && event.preventDefault()}>
        {t("remove")}
      </button>
      {state.error && <span className="text-[12px] text-status-danger">{t(`errors.${state.error}`)}</span>}
    </form>
  );
}
