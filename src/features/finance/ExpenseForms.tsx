"use client";

import { useActionState, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { Button } from "@/components/ui/Button";
import { FieldWrap, Input, Select } from "@/components/ui/Field";
import { MoneyInput } from "@/components/ui/FormattedInput";
import { suggestExpense } from "./ai/suggest-actions";
import type { Suggestion } from "./ai/suggest";
import { addExpense, skipServiceLog, voidExpense, type ExpenseState } from "./expense-actions";
import { expenseCategories, expenseMethods, expensePaidFrom } from "./report";

function Feedback({ state }: { state: ExpenseState }) {
  const t = useTranslations("expenses");
  if (state.error) return <span className="text-[13px] text-status-danger">{t(`errors.${state.error}`)}</span>;
  if (state.ok) return <span className="text-[13px] text-status-available">✓</span>;
  return null;
}

export type ServicePrefill = { serviceLogId: string; spentOn: string; amount: string; vendor: string; vehicleId: string; label: string };

export function ExpenseForm({
  today,
  vehicles,
  locations,
  serviceLogs,
  initial,
  baseHref,
  ai,
  vendorNames,
}: {
  today: string;
  vehicles: Array<{ id: string; fleet_number: string }>;
  locations: Array<{ id: string; name: string; name_zh: string | null }>;
  serviceLogs: Array<{ id: string; label: string }>;
  initial: ServicePrefill | null;
  baseHref: string;
  ai: { ready: boolean; used: number; cap: number };
  vendorNames: string[];
}) {
  const t = useTranslations("expenses");
  const locale = useLocale();
  const router = useRouter();
  const options = initial && !serviceLogs.some((log) => log.id === initial.serviceLogId) ? [{ id: initial.serviceLogId, label: initial.label }, ...serviceLogs] : serviceLogs;
  const [version, setVersion] = useState(0);
  const [locationId, setLocationId] = useState("");
  const [paidFrom, setPaidFrom] = useState("COMPANY_ACCOUNT");
  const [capital, setCapital] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiUsed, setAiUsed] = useState(ai.used);
  const askAi = async () => {
    const form = formRef.current;
    if (!form) return;
    const data = new FormData(form);
    const field = (name: string) => String(data.get(name) ?? "");
    setAiBusy(true);
    setAiError(null);
    setSuggestion(null);
    const result = await suggestExpense({ vendor: field("vendor"), note: field("note"), reference: field("reference"), amount: field("amount"), spentOn: field("spentOn"), locale });
    setAiBusy(false);
    if (result.used !== undefined) setAiUsed(result.used);
    if (result.ok) setSuggestion(result.suggestion);
    else setAiError(t(`ai.errors.${result.error}`));
  };
  const applySuggestion = () => {
    const form = formRef.current;
    if (!form || !suggestion) return;
    const set = (name: string, value: string) => {
      const element = form.elements.namedItem(name);
      if (element instanceof HTMLInputElement || element instanceof HTMLSelectElement) element.value = value;
    };
    set("category", suggestion.category);
    if (suggestion.vehicleId && !initial) set("vehicleId", suggestion.vehicleId);
    if (suggestion.locationId) setLocationId(suggestion.locationId);
    const box = form.elements.namedItem("capital");
    if (box instanceof HTMLInputElement) box.checked = suggestion.capital;
    setCapital(suggestion.capital);
    if (suggestion.capital) {
      set("serviceFrom", "");
      set("serviceTo", "");
    } else if (suggestion.serviceFrom && suggestion.serviceTo) {
      set("serviceFrom", suggestion.serviceFrom);
      set("serviceTo", suggestion.serviceTo);
    }
    setSuggestion(null);
  };
  const suggestedCar = suggestion?.vehicleId ? (vehicles.find((vehicle) => vehicle.id === suggestion.vehicleId)?.fleet_number ?? null) : null;
  const suggestedStore = suggestion?.locationId ? locations.find((location) => location.id === suggestion.locationId) : undefined;
  const [state, action, pending] = useActionState<ExpenseState, FormData>(async (previous, form) => {
    const next = await addExpense(previous, form);
    if (next.ok) {
      setCapital(false);
      setVersion((value) => value + 1);
    }
    return next;
  }, {});
  return (
    <form ref={formRef} key={`${version}:${initial?.serviceLogId ?? ""}`} action={action} className="grid gap-3 sm:grid-cols-4">
      <FieldWrap label={t("date")} htmlFor="spentOn">
        <Input id="spentOn" name="spentOn" type="date" required defaultValue={initial?.spentOn ?? today} max={today} />
      </FieldWrap>
      <FieldWrap label={t("category")} htmlFor="category">
        <Select id="category" name="category" required defaultValue={initial ? "MAINTENANCE" : ""}>
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
        <MoneyInput id="amount" name="amount" required placeholder="$" defaultValue={initial?.amount} />
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
        <Input id="vendor" name="vendor" maxLength={160} defaultValue={initial?.vendor} list="vendor-names" autoComplete="off" />
        <datalist id="vendor-names">
          {vendorNames.map((name) => (
            <option key={name} value={name} />
          ))}
        </datalist>
      </FieldWrap>
      <FieldWrap label={t("vehicle")} htmlFor="vehicleId">
        <Select id="vehicleId" name="vehicleId" defaultValue={initial?.vehicleId ?? ""}>
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
      <FieldWrap label={t("location")} htmlFor="locationId">
        <Select id="locationId" name="locationId" defaultValue={locationId} onChange={(event) => setLocationId(event.target.value)}>
          <option value="">—</option>
          {locations.map((location) => (
            <option key={location.id} value={location.id}>
              {locale === "zh" ? (location.name_zh ?? location.name) : location.name}
            </option>
          ))}
        </Select>
      </FieldWrap>
      <FieldWrap label={t("paidFrom")} htmlFor="paidFrom">
        <Select id="paidFrom" name="paidFrom" defaultValue={paidFrom} onChange={(event) => setPaidFrom(event.target.value)}>
          {expensePaidFrom.map((value) => (
            <option key={value} value={value}>
              {t(`paidFromOptions.${value}`)}
            </option>
          ))}
        </Select>
      </FieldWrap>
      <FieldWrap label={t("serviceFrom")} htmlFor="serviceFrom">
        <Input id="serviceFrom" name="serviceFrom" type="date" disabled={capital} />
      </FieldWrap>
      <FieldWrap label={t("serviceTo")} htmlFor="serviceTo">
        <Input id="serviceTo" name="serviceTo" type="date" disabled={capital} />
      </FieldWrap>
      <FieldWrap label={t("serviceLog")} htmlFor="serviceLogId">
        <Select id="serviceLogId" name="serviceLogId" defaultValue={initial?.serviceLogId ?? ""} onChange={(event) => router.push(event.target.value ? `${baseHref}&serviceLog=${event.target.value}` : baseHref, { scroll: false })}>
          <option value="">—</option>
          {options.map((log) => (
            <option key={log.id} value={log.id}>
              {log.label}
            </option>
          ))}
        </Select>
      </FieldWrap>
      {suggestion && (
        <div data-suggestion className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl bg-pearl/60 px-4 py-2.5 text-[13px] sm:col-span-4">
          <span className="min-w-0">
            {[t(`categories.${suggestion.category}`), suggestedCar, suggestedStore ? (locale === "zh" ? (suggestedStore.name_zh ?? suggestedStore.name) : suggestedStore.name) : null, suggestion.serviceFrom && suggestion.serviceTo ? t("spread", { from: suggestion.serviceFrom, to: suggestion.serviceTo }) : null, suggestion.capital ? t("capital") : null].filter(Boolean).join(" · ")}
            {suggestion.reason && <span className="text-muted"> — {suggestion.reason}</span>}
          </span>
          <button type="button" onClick={applySuggestion} className="text-[13px] text-gold hover:underline">
            {t("ai.apply")}
          </button>
          <button type="button" onClick={() => setSuggestion(null)} className="text-[12px] text-muted hover:text-ink">
            {t("ai.dismiss")}
          </button>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-3 sm:col-span-4">
        <label className="flex items-center gap-2 text-[13px]">
          <input type="checkbox" name="capital" defaultChecked={capital} onChange={(event) => setCapital(event.target.checked)} className="size-4 accent-[#b58b4b]" />
          {t("capital")}
        </label>
        <Button type="submit" size="sm" disabled={pending}>
          {t("add")}
        </Button>
        <Feedback state={state} />
        {ai.ready && (
          <span className="flex flex-wrap items-center gap-2 sm:ml-auto">
            <Button type="button" size="sm" variant="secondary" disabled={aiBusy || aiUsed >= ai.cap} onClick={askAi}>
              {aiBusy ? "…" : t("ai.suggest")}
            </Button>
            <span className="text-[12px] text-muted tabular-nums">{t("ai.used", { used: aiUsed, cap: ai.cap })}</span>
            {aiError && <span className="text-[12px] text-status-danger">{aiError}</span>}
          </span>
        )}
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

export function ServiceLink({ initial, clearHref }: { initial: ServicePrefill; clearHref: string }) {
  const t = useTranslations("expenses");
  const [state, action, pending] = useActionState<ExpenseState, FormData>(skipServiceLog, {});
  return (
    <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl bg-pearl/60 px-4 py-2.5 text-[13px]">
      <span>{t("linkedService", { label: initial.label })}</span>
      <details>
        <summary className="cursor-pointer list-none text-[12px] text-muted hover:text-status-danger">{t("skipService")}</summary>
        <form action={action} className="mt-2 flex items-center gap-2">
          <input type="hidden" name="serviceLogId" value={initial.serviceLogId} />
          <Input name="reason" required minLength={2} maxLength={500} placeholder={t("skipReason")} aria-label={t("skipReason")} className="h-8 w-56 text-[12px]" />
          <Button type="submit" size="sm" variant="secondary" className="h-8" disabled={pending}>
            {t("skipService")}
          </Button>
          <Feedback state={state} />
        </form>
      </details>
      <Link href={clearHref} className="text-[12px] text-muted hover:text-ink">
        {t("clearLink")}
      </Link>
    </div>
  );
}
