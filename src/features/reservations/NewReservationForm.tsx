"use client";

import { useActionState, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Button } from "@/components/ui/Button";
import { FieldWrap, Input, Select, Textarea } from "@/components/ui/Field";
import { isCouponLine } from "@/features/pricing/quote";
import { formatMoney } from "@/lib/utils/format";
import { draftReservation, type DraftState } from "./actions";
import { maxDrivers } from "@/features/drivers/types";
import { adjustmentCents, adjustmentDraftValid, maxAdjustments, signedAdjustment, type AdjustmentDraft } from "./adjustment";
import { bookingSources } from "./types";

type AdjustRow = AdjustmentDraft & { id: number };

const blankRow = (id: number): AdjustRow => ({ id, kind: "discount", note: "", amount: "" });

export type InitialDraft = { leadId?: string; values: Record<string, string>; addOns: string[] };

type Props = {
  initial?: InitialDraft;
  classes: Array<{ slug: string; name: string; name_zh: string | null; base_daily_rate_cents: number }>;
  locations: Array<{ id: string; name: string; name_zh: string | null }>;
  protections: string[];
  addOns: string[];
  slots: string[];
  defaults: { pickupDate: string; returnDate: string };
  canAdjust: boolean;
  discountLimitCents: number | null;
};

export function NewReservationForm({ classes, locations, protections, addOns, slots, defaults, initial, canAdjust, discountLimitCents }: Props) {
  const t = useTranslations("reservations");
  const locale = useLocale();
  const [state, action, pending] = useActionState<DraftState, FormData>(draftReservation, {});
  const value = (key: string, fallback = "") => state.values?.[key] || initial?.values[key] || fallback;
  const revision = JSON.stringify(state.values ?? {}) + (state.addOns ?? []).join();
  const [drivers, setDrivers] = useState({ on: (initial?.addOns ?? []).includes("driver"), count: "1", spouse: false });
  const [rows, setRows] = useState<AdjustRow[]>([blankRow(0)]);
  const setRow = (id: number, patch: Partial<AdjustmentDraft>) => setRows((list) => list.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  const adjustLines = canAdjust
    ? rows.flatMap((row) => {
        const cents = adjustmentCents(row.amount);
        return cents ? [{ id: row.id, label: row.note.trim(), cents: signedAdjustment(row.kind, cents) }] : [];
      })
    : [];
  const adjustCents = adjustLines.reduce((sum, line) => sum + line.cents, 0);
  const discountCents = adjustLines.reduce((sum, line) => sum - Math.min(0, line.cents), 0);
  const held = discountLimitCents !== null && discountCents > discountLimitCents;
  const appliedCents = held ? adjustCents + discountCents : adjustCents;
  const overdrawn = state.quote ? state.quote.totalCents + adjustCents < 0 : false;
  const adjustInvalid = canAdjust && (overdrawn || !rows.every(adjustmentDraftValid));
  const adjustError = canAdjust && (overdrawn || rows.some((row) => adjustmentCents(row.amount) === null));
  const money = (cents: number) => `${cents < 0 ? "−" : ""}${formatMoney(Math.abs(cents))}`;

  return (
    <form action={action} key={revision} autoComplete="off" className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_22rem]">
      <input type="hidden" name="leadId" value={initial?.leadId ?? ""} />
      {locations.length <= 1 && <input type="hidden" name="locationId" value={locations[0]?.id ?? ""} />}
      <div className="flex min-w-0 flex-col gap-5">
        <section className="card p-6">
          <h2 className="mb-4 text-sm font-semibold">{t("form.trip")}</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            {locations.length > 1 && (
              <FieldWrap label={t("form.location")} htmlFor="locationId" className="sm:col-span-2">
                <Select id="locationId" name="locationId" defaultValue={value("locationId", locations[0]?.id)}>
                  {locations.map((item) => (
                    <option key={item.id} value={item.id}>
                      {locale === "zh" ? (item.name_zh ?? item.name) : item.name}
                    </option>
                  ))}
                </Select>
              </FieldWrap>
            )}
            <FieldWrap label={t("form.class")} htmlFor="classSlug" className="sm:col-span-2">
              <Select id="classSlug" name="classSlug" defaultValue={value("classSlug", classes[0]?.slug)}>
                {classes.map((item) => (
                  <option key={item.slug} value={item.slug}>
                    {locale === "zh" ? (item.name_zh ?? item.name) : item.name} · {formatMoney(item.base_daily_rate_cents)}
                  </option>
                ))}
              </Select>
            </FieldWrap>
            <FieldWrap label={t("form.pickup")} htmlFor="pickupDate">
              <div className="flex gap-2">
                <div className="min-w-0 flex-1">
                  <Input id="pickupDate" name="pickupDate" type="date" required defaultValue={value("pickupDate", defaults.pickupDate)} />
                </div>
                <div className="w-28 shrink-0">
                <Select name="pickupTime" defaultValue={value("pickupTime", "10:00")} aria-label={t("form.pickup")}>
                  {slots.map((slot) => (
                    <option key={slot}>{slot}</option>
                  ))}
                </Select>
                </div>
              </div>
            </FieldWrap>
            <FieldWrap label={t("form.return")} htmlFor="returnDate">
              <div className="flex gap-2">
                <div className="min-w-0 flex-1">
                  <Input id="returnDate" name="returnDate" type="date" required defaultValue={value("returnDate", defaults.returnDate)} />
                </div>
                <div className="w-28 shrink-0">
                <Select name="returnTime" defaultValue={value("returnTime", "10:00")} aria-label={t("form.return")}>
                  {slots.map((slot) => (
                    <option key={slot}>{slot}</option>
                  ))}
                </Select>
                </div>
              </div>
            </FieldWrap>
            <FieldWrap label={t("form.protection")} htmlFor="protection">
              <Select id="protection" name="protection" defaultValue={value("protection", "none")}>
                {protections.map((item) => (
                  <option key={item} value={item}>
                    {t(`protection.${item}`)}
                  </option>
                ))}
              </Select>
            </FieldWrap>
            <FieldWrap label={t("form.ratePlan")} htmlFor="ratePlan">
              <Select id="ratePlan" name="ratePlan" defaultValue={value("ratePlan", "PAY_LATER")}>
                <option value="PAY_LATER">{t("ratePlan.PAY_LATER")}</option>
                <option value="PAY_NOW">{t("ratePlan.PAY_NOW")}</option>
              </Select>
            </FieldWrap>
            <FieldWrap label={t("form.ageBand")} htmlFor="ageBand">
              <Select id="ageBand" name="ageBand" defaultValue={value("ageBand", "25_PLUS")}>
                <option value="25_PLUS">{t("ageBand.25_PLUS")}</option>
                <option value="21_24">{t("ageBand.21_24")}</option>
              </Select>
            </FieldWrap>
            <FieldWrap label={t("form.pickupMethod")} htmlFor="pickupMethod">
              <Select id="pickupMethod" name="pickupMethod" defaultValue={value("pickupMethod", "STORE")}>
                <option value="STORE">{t("pickupMethod.STORE")}</option>
                <option value="DELIVERY">{t("pickupMethod.DELIVERY")}</option>
                <option value="SELF_SERVICE">{t("pickupMethod.SELF_SERVICE")}</option>
              </Select>
            </FieldWrap>
            <fieldset className="sm:col-span-2">
              <legend className="mb-2 text-xs font-medium tracking-wide text-charcoal">{t("form.addOns")}</legend>
              <div className="flex flex-wrap gap-x-5 gap-y-2">
                {addOns.map((item) => (
                  <label key={item} className="flex items-center gap-2 text-[13px] text-charcoal">
                    {item === "driver" ? (
                      <input type="checkbox" name="addOns" value={item} defaultChecked={drivers.on} onChange={(event) => setDrivers({ ...drivers, on: event.target.checked })} className="size-4 accent-[#b58b4b]" />
                    ) : (
                      <input type="checkbox" name="addOns" value={item} defaultChecked={(state.addOns ?? initial?.addOns ?? []).includes(item)} className="size-4 accent-[#b58b4b]" />
                    )}
                    {t(`addOn.${item}`)}
                  </label>
                ))}
              </div>
              {drivers.on && (
                <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-[13px] text-charcoal">
                  <label htmlFor="extraDrivers" className="flex items-center gap-2">
                    {t("form.extraDrivers")}
                    <span className="w-20">
                      <Select id="extraDrivers" name="extraDrivers" defaultValue={drivers.count} onChange={(event) => setDrivers({ ...drivers, count: event.target.value })}>
                        {Array.from({ length: maxDrivers }, (_, index) => (
                          <option key={index}>{index + 1}</option>
                        ))}
                      </Select>
                    </span>
                  </label>
                  <label className="flex items-center gap-2">
                    <input type="checkbox" name="spouseDriver" defaultChecked={drivers.spouse} onChange={(event) => setDrivers({ ...drivers, spouse: event.target.checked })} className="size-4 accent-[#b58b4b]" />
                    {t("form.spouseDriver")}
                  </label>
                </div>
              )}
            </fieldset>
            <FieldWrap label={t("form.deliveryAddress")} htmlFor="deliveryAddress" className="sm:col-span-2">
              <Input id="deliveryAddress" name="deliveryAddress" maxLength={300} defaultValue={value("deliveryAddress")} />
            </FieldWrap>
            <FieldWrap label={t("form.coupon")} htmlFor="couponCode">
              <Input id="couponCode" name="couponCode" maxLength={30} autoCapitalize="characters" autoComplete="off" defaultValue={value("couponCode")} className="uppercase" />
            </FieldWrap>
            {canAdjust && (
              <FieldWrap label={t("form.adjust")} htmlFor="adjustAmount" className="sm:col-span-2">
                <div className="flex flex-col gap-2">
                  {rows.map((row, index) => (
                    <div key={row.id} className={`grid gap-2 ${rows.length > 1 ? "sm:grid-cols-[7rem_minmax(0,1fr)_7rem_2.75rem]" : "sm:grid-cols-[7rem_minmax(0,1fr)_7rem]"}`}>
                      <Select name="adjustKind" defaultValue={row.kind} onChange={(event) => setRow(row.id, { kind: event.target.value === "fee" ? "fee" : "discount" })} aria-label={t("form.adjust")}>
                        <option value="discount">{t("edit.extraDiscount")}</option>
                        <option value="fee">{t("edit.extraFee")}</option>
                      </Select>
                      <Input name="adjustNote" value={row.note} onChange={(event) => setRow(row.id, { note: event.target.value })} placeholder={t("edit.extraDescription")} maxLength={120} />
                      <Input id={index === 0 ? "adjustAmount" : undefined} name="adjustAmount" inputMode="decimal" value={row.amount} onChange={(event) => setRow(row.id, { amount: event.target.value })} placeholder={t("edit.extraAmount")} aria-invalid={overdrawn || !adjustmentDraftValid(row)} />
                      {rows.length > 1 && (
                        <button type="button" onClick={() => setRows((list) => list.filter((item) => item.id !== row.id))} aria-label={t("edit.remove")} className="flex size-11 items-center justify-center rounded-xl text-lg leading-none text-muted hairline hover:border-ink/25 hover:text-ink">
                          ×
                        </button>
                      )}
                    </div>
                  ))}
                  {rows.length < maxAdjustments && (
                    <button type="button" onClick={() => setRows((list) => [...list, blankRow(Math.max(...list.map((item) => item.id)) + 1)])} aria-label={t("edit.add")} className="flex size-9 items-center justify-center self-start rounded-xl text-lg leading-none text-charcoal hairline hover:border-ink/25">
                      +
                    </button>
                  )}
                </div>
                {adjustError && (
                  <p className="text-xs text-status-danger" role="alert">
                    {t("errors.invalid_adjustment")}
                  </p>
                )}
              </FieldWrap>
            )}
          </div>
        </section>

        <section className="card p-6">
          <h2 className="mb-4 text-sm font-semibold">{t("form.customer")}</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <FieldWrap label={t("form.fullName")} htmlFor="fullName">
              <Input id="fullName" name="fullName" maxLength={120} defaultValue={value("fullName")} />
            </FieldWrap>
            <FieldWrap label={t("form.phone")} htmlFor="phone">
              <Input id="phone" name="phone" type="tel" maxLength={40} defaultValue={value("phone")} />
            </FieldWrap>
            <FieldWrap label={t("form.email")} htmlFor="email">
              <Input id="email" name="email" type="email" maxLength={200} defaultValue={value("email")} />
            </FieldWrap>
            <FieldWrap label={t("form.wechat")} htmlFor="wechat">
              <Input id="wechat" name="wechat" maxLength={60} defaultValue={value("wechat")} />
            </FieldWrap>
            <FieldWrap label={t("form.language")} htmlFor="language">
              <Select id="language" name="language" defaultValue={value("language", "zh")}>
                <option value="zh">中文</option>
                <option value="en">English</option>
              </Select>
            </FieldWrap>
            <FieldWrap label={t("form.source")} htmlFor="source">
              <Select id="source" name="source" defaultValue={value("source", "WECHAT")}>
                {bookingSources.map((item) => (
                  <option key={item} value={item}>
                    {t(`source.${item}`)}
                  </option>
                ))}
              </Select>
            </FieldWrap>
            <FieldWrap label={t("form.customerNotes")} htmlFor="customerNotes">
              <Textarea id="customerNotes" name="customerNotes" maxLength={2000} defaultValue={value("customerNotes")} className="min-h-20" />
            </FieldWrap>
            <FieldWrap label={t("form.internalNotes")} htmlFor="internalNotes">
              <Textarea id="internalNotes" name="internalNotes" maxLength={2000} defaultValue={value("internalNotes")} className="min-h-20" />
            </FieldWrap>
          </div>
        </section>
      </div>

      <aside className="flex flex-col gap-5">
        <section className="card p-6 xl:sticky xl:top-10">
          <h2 className="text-sm font-semibold">{t("form.quote")}</h2>
          {state.quote ? (
            <>
              <dl className="mt-3 flex flex-col gap-1.5 text-[13px]">
                {state.quote.lines.map((line) => (
                  <div key={line.code} className="flex justify-between gap-4">
                    <dt className="text-charcoal">
                      {t.has(`line.${line.code.replace(".", "_")}`) ? t(`line.${line.code.replace(".", "_")}`) : line.description}
                      {isCouponLine(line.code) && state.quote?.coupon ? ` ${state.quote.coupon.code}` : ""}
                    </dt>
                    <dd className="tabular-nums">{money(line.amountCents)}</dd>
                  </div>
                ))}
                {adjustLines.map((line) => (
                  <div key={line.id} className="flex justify-between gap-4">
                    <dt className="text-charcoal">
                      {line.label || t("form.adjust")}
                      {held && line.cents < 0 ? <span className="text-muted"> · {t("edit.awaiting")}</span> : null}
                    </dt>
                    <dd className={held && line.cents < 0 ? "tabular-nums text-muted" : "tabular-nums"}>{money(line.cents)}</dd>
                  </div>
                ))}
                <div className="mt-2 flex justify-between border-t border-ink/[0.08] pt-2.5 text-sm font-semibold">
                  <dt>{t("form.total")}</dt>
                  <dd className="tabular-nums">{formatMoney(state.quote.totalCents + appliedCents)}</dd>
                </div>
                <div className="flex justify-between text-xs text-muted">
                  <dt>{t("form.hold")}</dt>
                  <dd className="tabular-nums">{formatMoney(state.quote.securityHoldCents + state.quote.depositCents)}</dd>
                </div>
              </dl>
              {state.couponError && (
                <p className="mt-3 text-xs text-status-danger" role="alert">
                  {t.has(`errors.${state.couponError}`) ? t(`errors.${state.couponError}`) : state.couponError}
                </p>
              )}
              <p className={`mt-3 text-xs ${state.available?.length ? "text-status-available" : "text-status-danger"}`}>
                {state.available?.length ? t("form.available", { count: state.available.length }) : t("form.soldOut")}
              </p>
              {state.available && state.available.length > 0 && (
                <FieldWrap label={t("form.vehicle")} htmlFor="vehicleId" className="mt-3">
                  <Select id="vehicleId" name="vehicleId" defaultValue={value("vehicleId")}>
                    <option value="">{t("form.autoAssign")}</option>
                    {state.available.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.fleetNumber}
                      </option>
                    ))}
                  </Select>
                </FieldWrap>
              )}
              <FieldWrap label={t("form.initialStatus")} htmlFor="initialStatus" className="mt-3">
                <Select id="initialStatus" name="initialStatus" defaultValue={value("initialStatus", "CONFIRMED")}>
                  <option value="CONFIRMED">{t("status.CONFIRMED")}</option>
                  <option value="REQUESTED">{t("status.REQUESTED")}</option>
                </Select>
              </FieldWrap>
            </>
          ) : (
            <p className="mt-3 text-[13px] text-muted">{t("form.quoteHint")}</p>
          )}
          {state.error && (
            <p className="mt-3 rounded-xl bg-status-danger/8 px-3.5 py-2.5 text-[13px] text-status-danger" role="alert">
              {t.has(`errors.${state.error}`) ? t(`errors.${state.error}`) : state.error}
            </p>
          )}
          <div className="mt-4 flex flex-col gap-2">
            <Button type="submit" name="intent" value="preview" variant="secondary" disabled={pending}>
              {t("form.preview")}
            </Button>
            <Button type="submit" name="intent" value="create" disabled={pending || !state.quote || !state.available?.length || adjustInvalid}>
              {t("form.create")}
            </Button>
          </div>
        </section>
      </aside>
    </form>
  );
}
