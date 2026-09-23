"use client";

import { useActionState, useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/Button";
import { FieldWrap, Input, Select } from "@/components/ui/Field";
import { MoneyInput } from "@/components/ui/FormattedInput";
import { addExpense, voidExpense, type ExpenseState } from "./expense-actions";
import { expenseCategories, expenseMethods } from "./report";

function Feedback({ state }: { state: ExpenseState }) {
  const t = useTranslations("expenses");
  if (state.error) return <span className="text-[13px] text-status-danger">{t(`errors.${state.error}`)}</span>;
  if (state.ok) return <span className="text-[13px] text-status-available">✓</span>;
  return null;
}

export function ExpenseForm({ today, vehicles }: { today: string; vehicles: Array<{ id: string; fleet_number: string }> }) {
  const t = useTranslations("expenses");
  const [version, setVersion] = useState(0);
  const [state, action, pending] = useActionState<ExpenseState, FormData>(async (previous, form) => {
    const next = await addExpense(previous, form);
    if (next.ok) setVersion((value) => value + 1);
    return next;
  }, {});
  return (
    <form key={version} action={action} className="grid gap-3 sm:grid-cols-4">
      <FieldWrap label={t("date")} htmlFor="spentOn">
        <Input id="spentOn" name="spentOn" type="date" required defaultValue={today} max={today} />
      </FieldWrap>
      <FieldWrap label={t("category")} htmlFor="category">
        <Select id="category" name="category" required defaultValue="">
          <option value="" disabled>
            —
          </option>
          {expenseCategories.map((category) => (
            <option key={category} value={category}>
              {t(`categories.${category}`)}
            </option>
          ))}
        </Select>
      </FieldWrap>
      <FieldWrap label={t("amount")} htmlFor="amount">
        <MoneyInput id="amount" name="amount" required placeholder="$" />
      </FieldWrap>
      <FieldWrap label={t("method")} htmlFor="method">
        <Select id="method" name="method" defaultValue="CARD">
          {expenseMethods.map((method) => (
            <option key={method} value={method}>
              {t(`methods.${method}`)}
            </option>
          ))}
        </Select>
      </FieldWrap>
      <FieldWrap label={t("vendor")} htmlFor="vendor">
        <Input id="vendor" name="vendor" maxLength={160} />
      </FieldWrap>
      <FieldWrap label={t("vehicle")} htmlFor="vehicleId">
        <Select id="vehicleId" name="vehicleId" defaultValue="">
          <option value="">—</option>
          {vehicles.map((vehicle) => (
            <option key={vehicle.id} value={vehicle.id}>
              {vehicle.fleet_number}
            </option>
          ))}
        </Select>
      </FieldWrap>
      <FieldWrap label={t("reference")} htmlFor="reference">
        <Input id="reference" name="reference" maxLength={160} />
      </FieldWrap>
      <FieldWrap label={t("note")} htmlFor="note">
        <Input id="note" name="note" maxLength={1000} />
      </FieldWrap>
      <div className="flex items-center gap-3 sm:col-span-4">
        <Button type="submit" size="sm" disabled={pending}>
          {t("add")}
        </Button>
        <Feedback state={state} />
      </div>
    </form>
  );
}

export function VoidExpenseForm({ id }: { id: string }) {
  const t = useTranslations("expenses");
  const [state, action, pending] = useActionState<ExpenseState, FormData>(voidExpense, {});
  return (
    <details>
      <summary className="cursor-pointer list-none text-[12px] text-muted hover:text-status-danger">{t("void")}</summary>
      <form action={action} className="mt-2 flex items-center gap-2">
        <input type="hidden" name="id" value={id} />
        <Input name="reason" required minLength={2} maxLength={500} placeholder={t("voidReason")} aria-label={t("voidReason")} className="h-8 w-44 text-[12px]" />
        <Button type="submit" size="sm" variant="danger" className="h-8" disabled={pending} onClick={(event) => !confirm(t("confirmVoid")) && event.preventDefault()}>
          {t("void")}
        </Button>
        <Feedback state={state} />
      </form>
    </details>
  );
}
