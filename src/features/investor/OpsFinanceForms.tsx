"use client";

import { useActionState, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Button } from "@/components/ui/Button";
import { FieldWrap, Input, Select, Textarea } from "@/components/ui/Field";
import { MoneyInput } from "@/components/ui/FormattedInput";
import { formatMoney } from "@/lib/utils/format";
import type { VehicleOption } from "./contributions";
import { adjustLedger, backfillShares, confirmCapital, confirmVehicle, createAllocation, declineContribution, endAllocation, reverseEntry, suggestDeliveryOdometer, type FinanceState } from "./ops-finance-actions";

function Feedback({ state }: { state: FinanceState }) {
  const t = useTranslations("investors.finance");
  if (state.error) return <span className="text-[13px] text-status-danger">{t(`errors.${state.error}`)}</span>;
  if (state.ok) return <span className="text-[13px] text-status-available">✓</span>;
  return null;
}

function useDeliveryOdometer(enabled: boolean, initial?: number) {
  const fallback = initial === undefined ? "" : String(initial);
  const [value, setValue] = useState(fallback);
  const typed = useRef(false);
  const ticket = useRef(0);
  const suggest = (form: HTMLFormElement | null, picked = false) => {
    if (!enabled || !form) return;
    if (picked) {
      typed.current = false;
      setValue(fallback);
    }
    if (typed.current) return;
    const data = new FormData(form);
    const vehicleId = String(data.get("vehicleId") ?? "");
    const date = String(data.get("effectiveFrom") ?? "");
    const current = ++ticket.current;
    if (!vehicleId || !date) return;
    void suggestDeliveryOdometer(vehicleId, date)
      .then((reading) => {
        if (current === ticket.current && !typed.current) setValue(reading === null ? fallback : String(reading));
      })
      .catch(() => undefined);
  };
  return {
    value,
    suggest: (form: HTMLFormElement | null) => suggest(form),
    pick: (form: HTMLFormElement | null) => suggest(form, true),
    type: (next: string) => {
      typed.current = next.trim() !== "";
      setValue(next);
    },
  };
}

function VehicleSelect({ vehicles, name = "vehicleId", onPick }: { vehicles: VehicleOption[]; name?: string; onPick?: (form: HTMLFormElement | null) => void }) {
  const locale = useLocale();
  const t = useTranslations("investors.finance");
  return (
    <Select name={name} required defaultValue="" onChange={(event) => onPick?.(event.currentTarget.form)}>
      <option value="" disabled>
        {t("pickVehicle")}
      </option>
      {vehicles.map((vehicle) => (
        <option key={vehicle.id} value={vehicle.id} disabled={vehicle.allocated}>
          {vehicle.fleet_number} · {locale === "zh" ? (vehicle.class_name_zh ?? vehicle.class_name) : vehicle.class_name}
          {vehicle.allocated ? ` · ${t("allocated")}` : ""}
        </option>
      ))}
    </Select>
  );
}

export function ConfirmCapitalForm({ id, amount }: { id: string; amount: number }) {
  const t = useTranslations("investors.finance");
  const [state, action, pending] = useActionState<FinanceState, FormData>(confirmCapital, {});
  if (state.ok) return <span className="text-[13px] text-status-available">{t("confirmed")}</span>;
  return (
    <form action={action} className="grid gap-2 sm:grid-cols-[8rem_minmax(0,1fr)_auto]">
      <input type="hidden" name="id" value={id} />
      <MoneyInput name="received" required defaultValue={(amount / 100).toFixed(2)} aria-label={t("received")} />
      <Input name="reference" required maxLength={120} placeholder={t("reference")} aria-label={t("reference")} />
      <div className="flex items-center gap-2">
        <Button type="submit" size="sm" variant="gold" disabled={pending}>
          {t("confirmReceipt")}
        </Button>
        <Feedback state={state} />
      </div>
    </form>
  );
}

export function DeclineContributionForm({ id }: { id: string }) {
  const t = useTranslations("investors.finance");
  const [state, action, pending] = useActionState<FinanceState, FormData>(declineContribution, {});
  if (state.ok) return <span className="text-[13px] text-muted">{t("declined")}</span>;
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="id" value={id} />
      <Input name="note" maxLength={1000} placeholder={t("declineNote")} aria-label={t("declineNote")} className="h-9 w-56" />
      <Button type="submit" size="sm" variant="danger" disabled={pending} onClick={(event) => !confirm(t("confirmDecline")) && event.preventDefault()}>
        {t("decline")}
      </Button>
      <Feedback state={state} />
    </form>
  );
}

export function ConfirmVehicleForm({ id, investorId, vehicles, defaultShare, today, perMile, odometer }: { id: string; investorId: string; vehicles: VehicleOption[]; defaultShare: number; today: string; perMile?: boolean; odometer?: number }) {
  const t = useTranslations("investors.finance");
  const [state, action, pending] = useActionState<FinanceState, FormData>(confirmVehicle, {});
  const delivery = useDeliveryOdometer(Boolean(perMile), odometer);
  if (state.ok) return <span className="text-[13px] text-status-available">{t("confirmed")}</span>;
  return (
    <form action={action} className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_7rem_9rem_auto]">
      <input type="hidden" name="contributionId" value={id} />
      <input type="hidden" name="investorId" value={investorId} />
      <VehicleSelect vehicles={vehicles} onPick={delivery.pick} />
      {perMile ? <Input name="odometer" inputMode="numeric" required value={delivery.value} onChange={(event) => delivery.type(event.target.value)} placeholder={t("deliveryOdometer")} aria-label={t("deliveryOdometer")} title={t("deliveryOdometer")} /> : <Input value={`${defaultShare}%`} readOnly className="bg-pearl/60" aria-label={t("revenueShare")} title={t("revenueShare")} />}
      <Input name="effectiveFrom" type="date" required defaultValue={today} onChange={(event) => delivery.suggest(event.currentTarget.form)} aria-label={t("effectiveFrom")} />
      <div className="flex items-center gap-2">
        <Button type="submit" size="sm" variant="gold" disabled={pending}>
          {t("onboard")}
        </Button>
        <Feedback state={state} />
      </div>
    </form>
  );
}

export function AllocationForm({ investorId, vehicles, defaultShare, today, availableCents, perMile }: { investorId: string; vehicles: VehicleOption[]; defaultShare: number; today: string; availableCents: number; perMile?: boolean }) {
  const t = useTranslations("investors.finance");
  const [state, action, pending] = useActionState<FinanceState, FormData>(createAllocation, {});
  const delivery = useDeliveryOdometer(Boolean(perMile));
  return (
    <form action={action} className="grid gap-3 sm:grid-cols-2">
      <input type="hidden" name="investorId" value={investorId} />
      <FieldWrap label={t("vehicle")} htmlFor="allocVehicle" className="sm:col-span-2">
        <VehicleSelect vehicles={vehicles} onPick={delivery.pick} />
      </FieldWrap>
      <FieldWrap label={t("costBasis")} htmlFor="costBasis" hint={t("availableHint", { amount: (availableCents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" }) })}>
        <MoneyInput id="costBasis" name="costBasis" required placeholder="$" />
      </FieldWrap>
      {perMile ? (
        <FieldWrap label={t("deliveryOdometer")} htmlFor="allocOdometer">
          <Input id="allocOdometer" name="odometer" inputMode="numeric" required value={delivery.value} onChange={(event) => delivery.type(event.target.value)} />
        </FieldWrap>
      ) : (
        <FieldWrap label={t("revenueShare")} htmlFor="revenueShare">
          <Input id="revenueShare" value={`${defaultShare}%`} readOnly className="bg-pearl/60" />
        </FieldWrap>
      )}
      <FieldWrap label={t("effectiveFrom")} htmlFor="effectiveFrom">
        <Input id="effectiveFrom" name="effectiveFrom" type="date" required defaultValue={today} onChange={(event) => delivery.suggest(event.currentTarget.form)} />
      </FieldWrap>
      <div className="flex items-end gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          {t("allocate")}
        </Button>
        <Feedback state={state} />
      </div>
    </form>
  );
}

export function EndAllocationForm({ id, costBasisCents, today }: { id: string; costBasisCents: number; today: string }) {
  const t = useTranslations("investors.finance");
  const [state, action, pending] = useActionState<FinanceState, FormData>(endAllocation, {});
  if (state.ok) return <span className="text-[13px] text-status-available">{t("ended")}</span>;
  return (
    <details className="group">
      <summary className="cursor-pointer list-none text-[13px] text-status-danger hover:underline">{t("endAllocation")}</summary>
      <form action={action} className="mt-3 grid gap-2 sm:grid-cols-[8rem_9rem_minmax(0,1fr)_auto]">
        <input type="hidden" name="id" value={id} />
        <MoneyInput name="returned" required defaultValue={(costBasisCents / 100).toFixed(2)} aria-label={t("returned")} title={t("returned")} />
        <Input name="effectiveTo" type="date" required defaultValue={today} aria-label={t("effectiveTo")} />
        <Input name="note" required maxLength={1000} placeholder={t("endNote")} aria-label={t("endNote")} />
        <div className="flex items-center gap-2">
          <Button type="submit" size="sm" variant="danger" disabled={pending} onClick={(event) => !confirm(t("confirmEnd")) && event.preventDefault()}>
            {t("confirmEndButton")}
          </Button>
          <Feedback state={state} />
        </div>
      </form>
    </details>
  );
}

export function BackfillForm({ id, rows }: { id: string; rows: Array<{ number: string; date: string; amountCents: number }> }) {
  const t = useTranslations("investors.finance");
  const [state, action, pending] = useActionState<FinanceState, FormData>(backfillShares, {});
  const total = rows.reduce((sum, row) => sum + row.amountCents, 0);
  return (
    <form action={action} className="flex flex-col gap-2 text-[13px]">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="expected" value={total} />
      <ul className="divide-y divide-ink/[0.06]">
        {rows.map((row) => (
          <li key={row.number} className="grid grid-cols-[minmax(0,1fr)_7rem_7rem] gap-3 py-1.5">
            <span className="truncate font-medium">{row.number}</span>
            <span className="text-muted">{row.date}</span>
            <span className="text-right tabular-nums">{formatMoney(row.amountCents)}</span>
          </li>
        ))}
      </ul>
      <div className="flex items-center gap-2">
        <Button type="submit" size="sm" variant="gold" disabled={pending} onClick={(event) => !confirm(t("confirmBackfill")) && event.preventDefault()}>
          {t("backfill", { count: rows.length, amount: formatMoney(total) })}
        </Button>
        {state.ok ? <span className="text-[13px] text-status-available">{t("backfilled", { count: state.count ?? 0 })}</span> : <Feedback state={state} />}
      </div>
    </form>
  );
}

export function AdjustmentForm({ investorId, vehicles }: { investorId: string; vehicles: VehicleOption[] }) {
  const t = useTranslations("investors.finance");
  const [state, action, pending] = useActionState<FinanceState, FormData>(adjustLedger, {});
  return (
    <form action={action} className="grid gap-3 sm:grid-cols-[8rem_9rem_minmax(0,1fr)]">
      <input type="hidden" name="investorId" value={investorId} />
      <FieldWrap label={t("adjustAmount")} htmlFor="adjustAmount">
        <MoneyInput id="adjustAmount" name="amount" required placeholder="-$100.00" />
      </FieldWrap>
      <FieldWrap label={t("bucket")} htmlFor="adjustBucket">
        <Select id="adjustBucket" name="bucket" defaultValue="AVAILABLE">
          <option value="AVAILABLE">{t("buckets.AVAILABLE")}</option>
          <option value="PENDING">{t("buckets.PENDING")}</option>
        </Select>
      </FieldWrap>
      <FieldWrap label={t("vehicleOptional")} htmlFor="adjustVehicle">
        <Select id="adjustVehicle" name="vehicleId" defaultValue="">
          <option value="">—</option>
          {vehicles.map((vehicle) => (
            <option key={vehicle.id} value={vehicle.id}>
              {vehicle.fleet_number}
            </option>
          ))}
        </Select>
      </FieldWrap>
      <FieldWrap label={t("memo")} htmlFor="adjustMemo" className="sm:col-span-3">
        <Textarea id="adjustMemo" name="memo" required minLength={2} maxLength={1000} className="min-h-16" />
      </FieldWrap>
      <div className="flex items-center gap-2 sm:col-span-3">
        <Button type="submit" size="sm" variant="secondary" disabled={pending} onClick={(event) => !confirm(t("confirmAdjust")) && event.preventDefault()}>
          {t("postAdjustment")}
        </Button>
        <Feedback state={state} />
      </div>
    </form>
  );
}

export function ReverseEntryForm({ id }: { id: string }) {
  const t = useTranslations("investors.finance");
  const [state, action, pending] = useActionState<FinanceState, FormData>(reverseEntry, {});
  if (state.ok) return <span className="text-[12px] text-status-available">{t("reversed")}</span>;
  return (
    <details>
      <summary className="cursor-pointer list-none text-[12px] text-muted hover:text-status-danger">{t("reverse")}</summary>
      <form action={action} className="mt-2 flex items-center gap-2">
        <input type="hidden" name="id" value={id} />
        <Input name="memo" required minLength={2} maxLength={1000} placeholder={t("memo")} className="h-8 w-48 text-[12px]" />
        <Button type="submit" size="sm" variant="danger" className="h-8" disabled={pending} onClick={(event) => !confirm(t("confirmReverse")) && event.preventDefault()}>
          {t("reverse")}
        </Button>
        <Feedback state={state} />
      </form>
    </details>
  );
}
