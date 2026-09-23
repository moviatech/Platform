"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/Button";
import { FieldWrap, Input, Select } from "@/components/ui/Field";
import { addRateOverride, saveClassPricing, type PricingFormState } from "./actions";

type ClassRow = { id: string; name: string; base_daily_rate_cents: number; security_hold_cents: number; buffer_hours: number; active: boolean };

const toDollars = (cents: number) => (cents / 100).toFixed(cents % 100 === 0 ? 0 : 2);

export function ClassPricingForm({ item, editable }: { item: ClassRow; editable: boolean }) {
  const t = useTranslations("pricing");
  const common = useTranslations("common");
  const [state, action, pending] = useActionState<PricingFormState, FormData>(saveClassPricing, {});

  return (
    <form action={action} className="grid grid-cols-2 items-end gap-3 px-5 py-4 md:grid-cols-[minmax(0,1.4fr)_7rem_7rem_6rem_5rem_auto]">
      <input type="hidden" name="id" value={item.id} />
      <p className="col-span-2 text-sm font-medium md:col-span-1 md:pb-3">{item.name}</p>
      <FieldWrap label={t("dailyRate")} htmlFor={`rate-${item.id}`}>
        <Input id={`rate-${item.id}`} name="dailyRate" inputMode="decimal" defaultValue={toDollars(item.base_daily_rate_cents)} disabled={!editable} required />
      </FieldWrap>
      <FieldWrap label={t("securityHold")} htmlFor={`hold-${item.id}`}>
        <Input id={`hold-${item.id}`} name="securityHold" inputMode="decimal" defaultValue={toDollars(item.security_hold_cents)} disabled={!editable} required />
      </FieldWrap>
      <FieldWrap label={t("bufferHours")} htmlFor={`buffer-${item.id}`}>
        <Input id={`buffer-${item.id}`} name="bufferHours" type="number" min={0} max={72} defaultValue={item.buffer_hours} disabled={!editable} required />
      </FieldWrap>
      <label className="flex h-11 items-center gap-2 text-[13px] text-charcoal">
        <input type="checkbox" name="active" defaultChecked={item.active} disabled={!editable} className="size-4 accent-[#b58b4b]" />
        {t("active")}
      </label>
      {editable && (
        <div className="flex h-11 items-center gap-2">
          <Button type="submit" size="sm" variant="secondary" disabled={pending}>
            {common("save")}
          </Button>
          {state.ok && <span className="text-xs text-status-available">✓</span>}
          {state.error && <span className="text-xs text-status-danger">!</span>}
        </div>
      )}
    </form>
  );
}

export function OverrideForm({ classes, today }: { classes: Array<{ id: string; name: string }>; today: string }) {
  const t = useTranslations("pricing");
  const [state, action, pending] = useActionState<PricingFormState, FormData>(addRateOverride, {});

  return (
    <form action={action} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.3fr)_9.5rem_9.5rem_7rem_minmax(0,1fr)_auto] lg:items-end">
      <FieldWrap label={t("class")} htmlFor="classId">
        <Select id="classId" name="classId">
          {classes.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </Select>
      </FieldWrap>
      <FieldWrap label={t("from")} htmlFor="dateFrom">
        <Input id="dateFrom" name="dateFrom" type="date" defaultValue={today} required />
      </FieldWrap>
      <FieldWrap label={t("to")} htmlFor="dateTo">
        <Input id="dateTo" name="dateTo" type="date" defaultValue={today} required />
      </FieldWrap>
      <FieldWrap label={t("dailyRate")} htmlFor="overrideRate">
        <Input id="overrideRate" name="dailyRate" inputMode="decimal" required />
      </FieldWrap>
      <FieldWrap label={t("note")} htmlFor="note">
        <Input id="note" name="note" maxLength={120} />
      </FieldWrap>
      <div className="flex h-11 items-center gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          {t("addOverride")}
        </Button>
        {state.error && <span className="text-xs text-status-danger">!</span>}
      </div>
    </form>
  );
}
