"use client";

import { startTransition, useActionState, useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/Button";
import { FieldWrap, Input, Select } from "@/components/ui/Field";
import { saveCoupon, type CouponFormState } from "./actions";
import type { CouponRow } from "./rules";

type Option = { id: string; name: string };

const plain = (value: number) => String(Number(value.toFixed(2)));

export function CouponForm({ coupon, classes, locations }: { coupon?: CouponRow; classes: Option[]; locations: Option[] }) {
  const t = useTranslations("coupons");
  const common = useTranslations("common");
  const [state, action, pending] = useActionState<CouponFormState, FormData>(saveCoupon, {});
  const [kind, setKind] = useState<CouponRow["kind"]>(coupon?.kind ?? "PERCENT");
  const id = coupon?.id ?? "new";
  const check = "flex items-center gap-2 text-[13px] text-charcoal";
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    startTransition(() => action(data));
  };

  return (
    <form onSubmit={submit} key={coupon ? coupon.id : (state.at ?? 0)} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <input type="hidden" name="id" value={coupon?.id ?? ""} />
      <FieldWrap label={t("code")} htmlFor={`code-${id}`}>
        <Input id={`code-${id}`} name="code" defaultValue={coupon?.code ?? ""} required minLength={3} maxLength={30} pattern="[A-Za-z0-9][A-Za-z0-9_\-]{2,29}" autoCapitalize="characters" autoComplete="off" readOnly={Boolean(coupon)} className="font-mono uppercase read-only:opacity-60" />
      </FieldWrap>
      <FieldWrap label={t("label")} htmlFor={`label-${id}`}>
        <Input id={`label-${id}`} name="label" defaultValue={coupon?.label ?? ""} maxLength={120} />
      </FieldWrap>
      <FieldWrap label={t("kind")} htmlFor={`kind-${id}`}>
        <Select id={`kind-${id}`} name="kind" value={kind} onChange={(event) => setKind(event.target.value as CouponRow["kind"])}>
          <option value="PERCENT">{t("kinds.PERCENT")}</option>
          <option value="AMOUNT">{t("kinds.AMOUNT")}</option>
        </Select>
      </FieldWrap>
      <FieldWrap label={kind === "PERCENT" ? t("percent") : t("amount")} htmlFor={`value-${id}`}>
        <Input id={`value-${id}`} name="value" inputMode="decimal" required defaultValue={coupon ? plain(coupon.kind === "PERCENT" ? coupon.percent_bps / 100 : coupon.amount_cents / 100) : ""} />
      </FieldWrap>
      {kind === "PERCENT" && (
        <FieldWrap label={t("maxDiscount")} htmlFor={`max-${id}`}>
          <Input id={`max-${id}`} name="maxDiscount" inputMode="decimal" defaultValue={coupon?.max_discount_cents ? plain(coupon.max_discount_cents / 100) : ""} />
        </FieldWrap>
      )}
      <FieldWrap label={t("validFrom")} htmlFor={`from-${id}`}>
        <Input id={`from-${id}`} name="validFrom" type="date" defaultValue={coupon?.valid_from ?? ""} />
      </FieldWrap>
      <FieldWrap label={t("validTo")} htmlFor={`to-${id}`}>
        <Input id={`to-${id}`} name="validTo" type="date" defaultValue={coupon?.valid_to ?? ""} />
      </FieldWrap>
      <FieldWrap label={t("minDays")} htmlFor={`days-${id}`}>
        <Input id={`days-${id}`} name="minDays" type="number" min={1} max={365} defaultValue={coupon?.min_days ?? 1} />
      </FieldWrap>
      <FieldWrap label={t("maxRedemptions")} htmlFor={`total-${id}`}>
        <Input id={`total-${id}`} name="maxRedemptions" inputMode="numeric" defaultValue={coupon?.max_redemptions ?? ""} placeholder={t("unlimited")} />
      </FieldWrap>
      <FieldWrap label={t("perCustomer")} htmlFor={`each-${id}`}>
        <Input id={`each-${id}`} name="perCustomerLimit" inputMode="numeric" defaultValue={coupon ? (coupon.per_customer_limit ?? "") : 1} placeholder={t("unlimited")} />
      </FieldWrap>
      <FieldWrap label={t("bearer")} htmlFor={`bearer-${id}`}>
        <Select id={`bearer-${id}`} name="bearer" defaultValue={coupon?.bearer ?? "COMPANY"}>
          <option value="COMPANY">{t("bearers.COMPANY")}</option>
          <option value="SHARED">{t("bearers.SHARED")}</option>
        </Select>
      </FieldWrap>
      <fieldset className="sm:col-span-2">
        <legend className="mb-2 text-xs font-medium tracking-wide text-charcoal">{t("classes")}</legend>
        <div className="flex flex-wrap gap-x-5 gap-y-2">
          {classes.map((item) => (
            <label key={item.id} className={check}>
              <input type="checkbox" name="classIds" value={item.id} defaultChecked={coupon?.class_ids?.includes(item.id) ?? false} className="size-4 accent-[#b58b4b]" />
              {item.name}
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset className="sm:col-span-2">
        <legend className="mb-2 text-xs font-medium tracking-wide text-charcoal">{t("locations")}</legend>
        <div className="flex flex-wrap gap-x-5 gap-y-2">
          {locations.map((item) => (
            <label key={item.id} className={check}>
              <input type="checkbox" name="locationIds" value={item.id} defaultChecked={coupon?.location_ids?.includes(item.id) ?? false} className="size-4 accent-[#b58b4b]" />
              {item.name}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 sm:col-span-2 lg:col-span-4">
        <label className={check}>
          <input type="checkbox" name="stackable" defaultChecked={coupon?.stackable ?? false} className="size-4 accent-[#b58b4b]" />
          {t("stackable")}
        </label>
        <label className={check}>
          <input type="checkbox" name="firstOrderOnly" defaultChecked={coupon?.first_order_only ?? false} className="size-4 accent-[#b58b4b]" />
          {t("firstOrderOnly")}
        </label>
        <label className={check}>
          <input type="checkbox" name="active" defaultChecked={coupon?.active ?? true} className="size-4 accent-[#b58b4b]" />
          {t("active")}
        </label>
        <span className="ml-auto flex items-center gap-3">
          {state.ok && <span className="text-[13px] text-status-available">{common("saved")}</span>}
          {state.error && (
            <span className="text-[13px] text-status-danger" role="alert">
              {t(`errors.${state.error}`)}
            </span>
          )}
          <Button type="submit" size="sm" disabled={pending}>
            {coupon ? common("save") : t("create")}
          </Button>
        </span>
      </div>
    </form>
  );
}
