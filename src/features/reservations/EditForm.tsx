"use client";

import { useActionState, useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/Button";
import { FieldWrap, Input, Select } from "@/components/ui/Field";
import { formatMoney } from "@/lib/utils/format";
import { editReservation, type EditState } from "./edit-actions";

export type EditCurrent = {
  classSlug: string;
  pickupDate: string;
  pickupTime: string;
  returnDate: string;
  returnTime: string;
  protection: string;
  addOns: string[];
  ageBand: string;
  pickupMethod: string;
  deliveryAddress: string;
  totalCents: number;
};

type Props = {
  reservationId: string;
  current: EditCurrent;
  classes: Array<{ slug: string; name: string }>;
  protections: string[];
  addOns: string[];
  slots: string[];
};

export function EditForm({ reservationId, current, classes, protections, addOns, slots }: Props) {
  const t = useTranslations("reservations");
  const [state, action, pending] = useActionState<EditState, FormData>(editReservation, {});
  const value = (key: keyof EditCurrent) => state.values?.[key] ?? String(current[key]);
  const [method, setMethod] = useState(value("pickupMethod"));
  const selected = state.addOns ?? current.addOns;
  const diff = state.quote ? state.quote.totalCents - current.totalCents : 0;

  return (
    <form action={action} className="flex flex-col gap-5">
      <input type="hidden" name="reservationId" value={reservationId} />
      <div className="grid gap-4 sm:grid-cols-2">
        <FieldWrap label={t("form.class")} htmlFor="classSlug" className="sm:col-span-2">
          <Select id="classSlug" name="classSlug" defaultValue={value("classSlug")}>
            {classes.map((item) => (
              <option key={item.slug} value={item.slug}>
                {item.name}
              </option>
            ))}
          </Select>
        </FieldWrap>
        <div className="grid grid-cols-[minmax(0,1fr)_7rem] gap-2">
          <FieldWrap label={t("form.pickup")} htmlFor="pickupDate">
            <Input id="pickupDate" name="pickupDate" type="date" required defaultValue={value("pickupDate")} />
          </FieldWrap>
          <div className="flex flex-col justify-end">
            <Select name="pickupTime" defaultValue={value("pickupTime")} aria-label={t("form.pickup")}>
              {slots.map((slot) => (
                <option key={slot} value={slot}>
                  {slot}
                </option>
              ))}
            </Select>
          </div>
        </div>
        <div className="grid grid-cols-[minmax(0,1fr)_7rem] gap-2">
          <FieldWrap label={t("form.return")} htmlFor="returnDate">
            <Input id="returnDate" name="returnDate" type="date" required defaultValue={value("returnDate")} />
          </FieldWrap>
          <div className="flex flex-col justify-end">
            <Select name="returnTime" defaultValue={value("returnTime")} aria-label={t("form.return")}>
              {slots.map((slot) => (
                <option key={slot} value={slot}>
                  {slot}
                </option>
              ))}
            </Select>
          </div>
        </div>
        <FieldWrap label={t("form.protection")} htmlFor="protection">
          <Select id="protection" name="protection" defaultValue={value("protection")}>
            {protections.map((item) => (
              <option key={item} value={item}>
                {t(`protection.${item}`)}
              </option>
            ))}
          </Select>
        </FieldWrap>
        <FieldWrap label={t("form.ageBand")} htmlFor="ageBand">
          <Select id="ageBand" name="ageBand" defaultValue={value("ageBand")}>
            <option value="25_PLUS">{t("ageBand.25_PLUS")}</option>
            <option value="21_24">{t("ageBand.21_24")}</option>
          </Select>
        </FieldWrap>
        <FieldWrap label={t("form.pickupMethod")} htmlFor="pickupMethod">
          <Select id="pickupMethod" name="pickupMethod" value={method} onChange={(event) => setMethod(event.target.value)}>
            <option value="STORE">{t("pickupMethod.STORE")}</option>
            <option value="DELIVERY">{t("pickupMethod.DELIVERY")}</option>
          </Select>
        </FieldWrap>
        {method === "DELIVERY" && (
          <FieldWrap label={t("form.deliveryAddress")} htmlFor="deliveryAddress">
            <Input id="deliveryAddress" name="deliveryAddress" defaultValue={value("deliveryAddress")} maxLength={300} />
          </FieldWrap>
        )}
      </div>
      <div className="flex flex-col gap-2">
        <p className="text-xs font-medium tracking-wide text-charcoal">{t("form.addOns")}</p>
        <div className="flex flex-wrap gap-x-5 gap-y-2">
          {addOns.map((item) => (
            <label key={item} className="flex items-center gap-2 text-[13px] text-charcoal">
              <input type="checkbox" name="addOns" value={item} defaultChecked={selected.includes(item)} className="size-4 accent-[#b58b4b]" />
              {t(`addOn.${item}`)}
            </label>
          ))}
        </div>
      </div>
      <div className="rounded-xl bg-pearl px-4 py-3 text-[13px]">
        <div className="flex justify-between">
          <span className="text-muted">{t("edit.currentTotal")}</span>
          <span className="tabular-nums">{formatMoney(current.totalCents)}</span>
        </div>
        {state.quote && (
          <>
            <div className="mt-1 flex justify-between font-semibold">
              <span>{t("edit.newTotal")}</span>
              <span className="tabular-nums">{formatMoney(state.quote.totalCents)}</span>
            </div>
            <div className="mt-1 flex justify-between">
              <span className="text-muted">{t("edit.difference")}</span>
              <span className={diff > 0 ? "tabular-nums text-status-danger" : diff < 0 ? "tabular-nums text-status-available" : "tabular-nums"}>
                {diff === 0 ? t("edit.noChange") : `${diff > 0 ? "+" : "−"}${formatMoney(Math.abs(diff))}`}
              </span>
            </div>
            <p className="mt-1 text-muted">{state.available === 0 ? t("form.soldOut") : t("form.available", { count: state.available ?? 0 })}</p>
          </>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" name="intent" value="preview" variant="secondary" disabled={pending}>
          {t("edit.preview")}
        </Button>
        <Button type="submit" name="intent" value="save" disabled={pending || !state.quote}>
          {t("edit.save")}
        </Button>
      </div>
      {state.error && (
        <p className="text-[13px] text-status-danger" role="alert">
          {t.has(`errors.${state.error}`) ? t(`errors.${state.error}`) : state.error}
        </p>
      )}
    </form>
  );
}
