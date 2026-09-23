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
  lines: Array<{ code: string; description: string; quantity: number; amountCents: number }>;
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
  const manualLines = current.lines.filter((line) => line.code.startsWith("manual."));
  const manualCents = manualLines.reduce((sum, line) => sum + line.amountCents, 0);
  const extraCents = state.extraCents ?? 0;
  const newTotal = state.quote ? state.quote.totalCents + manualCents + extraCents : current.totalCents;
  const diff = state.quote ? newTotal - current.totalCents : 0;
  const label = (code: string, description: string) => (t.has(`line.${code.replace(".", "_")}`) ? t(`line.${code.replace(".", "_")}`) : description);
  const breakdown = state.quote
    ? [
        ...state.quote.lines.map((line) => {
          const before = current.lines.find((item) => item.code === line.code);
          return { code: line.code, label: label(line.code, line.description), quantity: line.quantity, amountCents: line.amountCents, deltaCents: line.amountCents - (before?.amountCents ?? 0), previousQuantity: before?.quantity ?? null };
        }),
        ...current.lines
          .filter((line) => !line.code.startsWith("manual.") && !state.quote?.lines.some((item) => item.code === line.code))
          .map((line) => ({ code: line.code, label: label(line.code, line.description), quantity: 0, amountCents: 0, deltaCents: -line.amountCents, previousQuantity: line.quantity })),
        ...manualLines.map((line) => ({ code: `${line.code}:${line.description}`, label: line.description, quantity: 1, amountCents: line.amountCents, deltaCents: 0, previousQuantity: null })),
        ...(extraCents !== 0 ? [{ code: "extra", label: state.values?.extraDescription || t("edit.extraLabel"), quantity: 1, amountCents: extraCents, deltaCents: extraCents, previousQuantity: null }] : []),
      ]
    : [];
  const money = (cents: number) => `${cents < 0 ? "−" : ""}${formatMoney(Math.abs(cents))}`;

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
                <option value="SELF_SERVICE">{t("pickupMethod.SELF_SERVICE")}</option>
          </Select>
        </FieldWrap>
        {(method === "DELIVERY" || method === "SELF_SERVICE") && (
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
      <div className="grid gap-2 sm:grid-cols-[7rem_minmax(0,1fr)_7rem]">
        <Select name="extraKind" defaultValue={state.values?.extraKind ?? "fee"} aria-label={t("edit.extraLabel")}>
          <option value="fee">{t("edit.extraFee")}</option>
          <option value="discount">{t("edit.extraDiscount")}</option>
        </Select>
        <Input name="extraDescription" defaultValue={state.values?.extraDescription ?? ""} placeholder={t("edit.extraDescription")} maxLength={120} />
        <Input name="extraAmount" inputMode="decimal" defaultValue={state.values?.extraAmount ?? ""} placeholder={t("edit.extraAmount")} />
      </div>
      <div className="rounded-xl bg-pearl px-4 py-3 text-[13px]">
        <div className="flex justify-between">
          <span className="text-muted">{t("edit.currentTotal")}</span>
          <span className="tabular-nums">{formatMoney(current.totalCents)}</span>
        </div>
        {state.quote && (
          <>
            <ul className="mt-2 flex flex-col gap-1 border-t border-ink/[0.08] pt-2">
              {breakdown.map((row) => (
                <li key={row.code} className="flex justify-between gap-3">
                  <span className="text-charcoal">
                    {row.label}
                    {row.quantity > 1 || (row.previousQuantity ?? 0) > 1 ? <span className="text-muted"> × {row.previousQuantity !== null && row.previousQuantity !== row.quantity ? `${row.previousQuantity} → ${row.quantity}` : row.quantity}</span> : null}
                  </span>
                  <span className="tabular-nums">
                    {money(row.amountCents)}
                    {row.deltaCents !== 0 && <span className={row.deltaCents > 0 ? "text-status-danger" : "text-status-available"}> ({row.deltaCents > 0 ? "+" : "−"}{formatMoney(Math.abs(row.deltaCents))})</span>}
                  </span>
                </li>
              ))}
            </ul>
            <div className="mt-2 flex justify-between border-t border-ink/[0.08] pt-2 font-semibold">
              <span>{t("edit.newTotal")}</span>
              <span className="tabular-nums">{formatMoney(newTotal)}</span>
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
