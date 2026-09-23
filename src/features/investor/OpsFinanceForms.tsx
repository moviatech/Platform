"use client";

import { useActionState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Button } from "@/components/ui/Button";
import { FieldWrap, Input, Select, Textarea } from "@/components/ui/Field";
import { MoneyInput } from "@/components/ui/FormattedInput";
import type { VehicleOption } from "./contributions";
import { adjustLedger, confirmCapital, confirmVehicle, createAllocation, declineContribution, endAllocation, reverseEntry, type FinanceState } from "./ops-finance-actions";

function Feedback({ state }: { state: FinanceState }) {
  const t = useTranslations("investors.finance");
  if (state.error) return <span className="text-[13px] text-status-danger">{t(`errors.${state.error}`)}</span>;
  if (state.ok) return <span className="text-[13px] text-status-available">✓</span>;
  return null;
}

function VehicleSelect({ vehicles, name = "vehicleId" }: { vehicles: VehicleOption[]; name?: string }) {
  const locale = useLocale();
  const t = useTranslations("investors.finance");
  return (
    <Select name={name} required defaultValue="">
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

export function ConfirmVehicleForm({ id, investorId, vehicles, defaultShare, today }: { id: string; investorId: string; vehicles: VehicleOption[]; defaultShare: number; today: string }) {
  const t = useTranslations("investors.finance");
  const [state, action, pending] = useActionState<FinanceState, FormData>(confirmVehicle, {});
  if (state.ok) return <span className="text-[13px] text-status-available">{t("confirmed")}</span>;
  return (
    <form action={action} className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_6rem_9rem_auto]">
      <input type="hidden" name="contributionId" value={id} />
      <input type="hidden" name="investorId" value={investorId} />
      <VehicleSelect vehicles={vehicles} />
      <Input name="revenueShare" inputMode="decimal" required defaultValue={String(defaultShare)} aria-label={t("revenueShare")} title={t("revenueShare")} />
      <Input name="effectiveFrom" type="date" required defaultValue={today} aria-label={t("effectiveFrom")} />
      <div className="flex items-center gap-2">
        <Button type="submit" size="sm" variant="gold" disabled={pending}>
          {t("onboard")}
        </Button>
        <Feedback state={state} />
      </div>
    </form>
  );
}

export function AllocationForm({ investorId, vehicles, defaultShare, today, availableCents }: { investorId: string; vehicles: VehicleOption[]; defaultShare: number; today: string; availableCents: number }) {
  const t = useTranslations("investors.finance");
  const [state, action, pending] = useActionState<FinanceState, FormData>(createAllocation, {});
  return (
    <form action={action} className="grid gap-3 sm:grid-cols-2">
      <input type="hidden" name="investorId" value={investorId} />
      <FieldWrap label={t("vehicle")} htmlFor="allocVehicle" className="sm:col-span-2">
        <VehicleSelect vehicles={vehicles} />
      </FieldWrap>
      <FieldWrap label={t("costBasis")} htmlFor="costBasis" hint={t("availableHint", { amount: (availableCents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" }) })}>
        <MoneyInput id="costBasis" name="costBasis" required placeholder="$" />
      </FieldWrap>
      <FieldWrap label={t("revenueShare")} htmlFor="revenueShare">
        <Input id="revenueShare" name="revenueShare" inputMode="decimal" required defaultValue={String(defaultShare)} />
      </FieldWrap>
      <FieldWrap label={t("effectiveFrom")} htmlFor="effectiveFrom">
        <Input id="effectiveFrom" name="effectiveFrom" type="date" required defaultValue={today} />
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
