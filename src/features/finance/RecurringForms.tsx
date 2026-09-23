"use client";

import { useActionState, useRef, useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { Button } from "@/components/ui/Button";
import { FieldWrap, Input, Select } from "@/components/ui/Field";
import { MoneyInput, formatMoneyInput } from "@/components/ui/FormattedInput";
import { attachReceipt, createReceiptUpload } from "./expense-actions";
import { recurringIntervals, settlementKinds } from "./recurring";
import { addRecurring, addSettlement, confirmRecurring, deleteRecurring, skipRecurring, stopRecurring, voidSettlement, type RecurringState } from "./recurring-actions";
import { expenseCategories, expenseMethods, expensePaidFrom, maxReceiptBytes, receiptTypes } from "./report";

function Feedback({ state }: { state: RecurringState }) {
  const t = useTranslations("expenses");
  if (state.error) return <span className="text-[13px] text-status-danger">{t(`errors.${state.error}`)}</span>;
  if (state.ok) return <span className="text-[13px] text-status-available">✓</span>;
  return null;
}

function useSubmit(run: (previous: RecurringState, form: FormData) => Promise<RecurringState>) {
  const [version, setVersion] = useState(0);
  const [, startTransition] = useTransition();
  const [state, dispatch, pending] = useActionState<RecurringState, FormData>(async (previous, form) => {
    const next = await run(previous, form);
    if (next.ok) setVersion((value) => value + 1);
    return next;
  }, {});
  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    startTransition(() => dispatch(data));
  };
  return { version, state, pending, onSubmit };
}

type VehicleOption = { id: string; fleet_number: string };
type PlaceOption = { id: string; name: string; name_zh: string | null };

export function RecurringForm({ today, vehicles, locations }: { today: string; vehicles: VehicleOption[]; locations: PlaceOption[] }) {
  const t = useTranslations("expenses");
  const locale = useLocale();
  const { version, state, pending, onSubmit } = useSubmit(addRecurring);
  return (
    <form key={version} onSubmit={onSubmit} className="grid gap-3 sm:grid-cols-4">
      <FieldWrap label={t("recurringName")} htmlFor="name">
        <Input id="name" name="name" required maxLength={80} />
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
      <FieldWrap label={t("every")} htmlFor="everyMonths">
        <Select id="everyMonths" name="everyMonths" defaultValue="1">
          {recurringIntervals.map((months) => (
            <option key={months} value={months}>
              {t(`everyOptions.${months}`)}
            </option>
          ))}
        </Select>
      </FieldWrap>
      <FieldWrap label={t("startsOn")} htmlFor="startsOn">
        <Input id="startsOn" name="startsOn" type="date" required defaultValue={today} />
      </FieldWrap>
      <FieldWrap label={t("endsOn")} htmlFor="endsOn">
        <Input id="endsOn" name="endsOn" type="date" />
      </FieldWrap>
      <FieldWrap label={t("vendor")} htmlFor="vendor">
        <Input id="vendor" name="vendor" maxLength={160} />
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
      <FieldWrap label={t("location")} htmlFor="locationId">
        <Select id="locationId" name="locationId" defaultValue="">
          <option value="">—</option>
          {locations.map((location) => (
            <option key={location.id} value={location.id}>
              {locale === "zh" ? (location.name_zh ?? location.name) : location.name}
            </option>
          ))}
        </Select>
      </FieldWrap>
      <FieldWrap label={t("paidFrom")} htmlFor="paidFrom">
        <Select id="paidFrom" name="paidFrom" defaultValue="COMPANY_ACCOUNT">
          {expensePaidFrom.map((value) => (
            <option key={value} value={value}>
              {t(`paidFromOptions.${value}`)}
            </option>
          ))}
        </Select>
      </FieldWrap>
      <FieldWrap label={t("note")} htmlFor="note">
        <Input id="note" name="note" maxLength={1000} />
      </FieldWrap>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-3 sm:col-span-4">
        <label className="flex items-center gap-2 text-[13px]">
          <input type="checkbox" name="spread" className="size-4 accent-[#b58b4b]" />
          {t("spreadCycle")}
        </label>
        <Button type="submit" size="sm" disabled={pending}>
          {t("recurringAdd")}
        </Button>
        <Feedback state={state} />
      </div>
    </form>
  );
}

export function RecurringEnd({ id, used }: { id: string; used: boolean }) {
  const t = useTranslations("expenses");
  const [state, action, pending] = useActionState<RecurringState, FormData>(used ? stopRecurring : deleteRecurring, {});
  return (
    <form action={action} className="flex items-center gap-2">
      <input type="hidden" name="id" value={id} />
      <button type="submit" disabled={pending} onClick={(event) => !confirm(t(used ? "confirmStop" : "confirmDelete")) && event.preventDefault()} className="text-[12px] text-muted hover:text-status-danger">
        {t(used ? "stop" : "delete")}
      </button>
      {state.error && <Feedback state={state} />}
    </form>
  );
}

export function DueActions({ recurringId, dueOn, amountCents, today }: { recurringId: string; dueOn: string; amountCents: number; today: string }) {
  const t = useTranslations("expenses");
  const router = useRouter();
  const picker = useRef<HTMLInputElement>(null);
  const [spentOn, setSpentOn] = useState(dueOn);
  const [amount, setAmount] = useState(formatMoneyInput((amountCents / 100).toFixed(2)));
  const [file, setFile] = useState<File | null>(null);
  const [stage, setStage] = useState<"idle" | "busy" | "done" | "uploadFailed">("idle");
  const [error, setError] = useState<string | null>(null);

  const confirmDue = async () => {
    setError(null);
    if (file && (!receiptTypes.test(file.type) || file.size <= 0 || file.size > maxReceiptBytes)) {
      setError(t("attachFailed"));
      return;
    }
    setStage("busy");
    const result = await confirmRecurring({ recurringId, dueOn, spentOn, amount });
    if (!result.ok || !result.expenseId) {
      setError(t(`errors.${result.error ?? "failed"}`));
      setStage("idle");
      return;
    }
    if (file) {
      const target = await createReceiptUpload(result.expenseId, { type: file.type, size: file.size });
      const sent = target ? await fetch(target.url, { method: "PUT", headers: { "Content-Type": file.type }, body: file }).catch(() => null) : null;
      const attached = target && sent?.ok ? await attachReceipt(result.expenseId, target.path, file.type, file.size) : { ok: false };
      if (!attached.ok) {
        setStage("uploadFailed");
        return;
      }
    }
    setStage("done");
    router.refresh();
  };

  const skipDue = async () => {
    if (!confirm(t("confirmSkip"))) return;
    setError(null);
    setStage("busy");
    const result = await skipRecurring({ recurringId, dueOn });
    if (!result.ok) {
      setError(t(`errors.${result.error ?? "failed"}`));
      setStage("idle");
    }
  };

  if (stage === "done" || stage === "uploadFailed") {
    return <span className={stage === "done" ? "text-[13px] text-status-available" : "text-[13px] text-status-danger"}>{stage === "done" ? "✓" : `✓ · ${t("attachFailed")}`}</span>;
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="w-40">
        <Input type="date" value={spentOn} max={today} onChange={(event) => setSpentOn(event.target.value)} aria-label={t("date")} />
      </div>
      <div className="w-32">
        <MoneyInput value={amount} onValueChange={setAmount} aria-label={t("amount")} />
      </div>
      <input ref={picker} type="file" hidden accept="application/pdf,image/jpeg,image/png,image/webp,image/heic" onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
      <button type="button" onClick={() => picker.current?.click()} className="max-w-32 truncate text-[12px] text-gold hover:underline">
        {file ? file.name : t("attach")}
      </button>
      <Button type="button" size="sm" disabled={stage === "busy"} onClick={confirmDue}>
        {t("confirmDue")}
      </Button>
      <button type="button" disabled={stage === "busy"} onClick={skipDue} className="text-[12px] text-muted hover:text-status-danger">
        {t("skip")}
      </button>
      {error && <span className="text-[12px] text-status-danger">{error}</span>}
    </div>
  );
}

export function SettlementForm({ today }: { today: string }) {
  const t = useTranslations("expenses");
  const { version, state, pending, onSubmit } = useSubmit(addSettlement);
  return (
    <form key={version} onSubmit={onSubmit} className="grid gap-3 sm:grid-cols-5">
      <FieldWrap label={t("settlementKind")} htmlFor="kind">
        <Select id="kind" name="kind" defaultValue="CARD_PAYMENT">
          {settlementKinds.map((kind) => (
            <option key={kind} value={kind}>
              {t(`settlementKinds.${kind}`)}
            </option>
          ))}
        </Select>
      </FieldWrap>
      <FieldWrap label={t("date")} htmlFor="paidOn">
        <Input id="paidOn" name="paidOn" type="date" required defaultValue={today} max={today} />
      </FieldWrap>
      <FieldWrap label={t("amount")} htmlFor="settlementAmount">
        <MoneyInput id="settlementAmount" name="amount" required placeholder="$" />
      </FieldWrap>
      <FieldWrap label={t("reference")} htmlFor="settlementReference">
        <Input id="settlementReference" name="reference" maxLength={160} />
      </FieldWrap>
      <FieldWrap label={t("note")} htmlFor="settlementNote">
        <Input id="settlementNote" name="note" maxLength={1000} />
      </FieldWrap>
      <div className="flex items-center gap-4 sm:col-span-5">
        <Button type="submit" size="sm" disabled={pending}>
          {t("settlementAdd")}
        </Button>
        <Feedback state={state} />
      </div>
    </form>
  );
}

export function VoidSettlementForm({ id }: { id: string }) {
  const t = useTranslations("expenses");
  const [state, action, pending] = useActionState<RecurringState, FormData>(voidSettlement, {});
  return (
    <details>
      <summary className="cursor-pointer list-none text-[12px] text-muted hover:text-status-danger">{t("void")}</summary>
      <form action={action} className="mt-2 flex items-center gap-2">
        <input type="hidden" name="id" value={id} />
        <Input name="reason" required minLength={2} maxLength={500} placeholder={t("voidReason")} aria-label={t("voidReason")} className="h-8 w-44 text-[12px]" />
        <Button type="submit" size="sm" variant="danger" className="h-8" disabled={pending} onClick={(event) => !confirm(t("confirmVoidSettlement")) && event.preventDefault()}>
          {t("void")}
        </Button>
        <Feedback state={state} />
      </form>
    </details>
  );
}
