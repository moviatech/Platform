"use client";

import { useActionState, useState, useTransition, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/Button";
import { FieldWrap, Input, Select } from "@/components/ui/Field";
import { addVendor, deleteVendor, updateVendor, type VendorState } from "./vendor-actions";
import { vendorTaxClasses, type VendorTaxClass } from "./vendors";

function Feedback({ state }: { state: VendorState }) {
  const t = useTranslations("expenses");
  if (state.error) return <span className="text-[13px] text-status-danger">{t(`errors.${state.error}`)}</span>;
  if (state.ok) return <span className="text-[13px] text-status-available">✓</span>;
  return null;
}

function useSubmit(run: (previous: VendorState, form: FormData) => Promise<VendorState>, resetOnOk: boolean) {
  const [version, setVersion] = useState(0);
  const [, startTransition] = useTransition();
  const [state, dispatch, pending] = useActionState<VendorState, FormData>(async (previous, form) => {
    const next = await run(previous, form);
    if (next.ok && resetOnOk) setVersion((value) => value + 1);
    return next;
  }, {});
  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    startTransition(() => dispatch(data));
  };
  return { version, state, pending, onSubmit };
}

type VendorValues = { id?: string; name: string; tax_class: VendorTaxClass; needs_1099: boolean; w9_received_on: string | null; note: string | null; active: boolean };

function VendorFields({ prefix, value, today, withActive }: { prefix: string; value: VendorValues | null; today: string; withActive: boolean }) {
  const t = useTranslations("expenses");
  return (
    <>
      <FieldWrap label={t("vendors.name")} htmlFor={`${prefix}-name`}>
        <Input id={`${prefix}-name`} name="name" required maxLength={160} defaultValue={value?.name} />
      </FieldWrap>
      <FieldWrap label={t("vendors.taxClass")} htmlFor={`${prefix}-taxClass`}>
        <Select id={`${prefix}-taxClass`} name="taxClass" defaultValue={value?.tax_class ?? "UNKNOWN"}>
          {vendorTaxClasses.map((taxClass) => (
            <option key={taxClass} value={taxClass}>
              {t(`vendors.taxClasses.${taxClass}`)}
            </option>
          ))}
        </Select>
      </FieldWrap>
      <FieldWrap label={t("vendors.w9On")} htmlFor={`${prefix}-w9On`}>
        <Input id={`${prefix}-w9On`} name="w9On" type="date" max={today} defaultValue={value?.w9_received_on ?? undefined} />
      </FieldWrap>
      <FieldWrap label={t("note")} htmlFor={`${prefix}-note`}>
        <Input id={`${prefix}-note`} name="note" maxLength={1000} defaultValue={value?.note ?? undefined} />
      </FieldWrap>
      <label className="flex items-center gap-2 text-[13px]">
        <input type="checkbox" name="needs1099" defaultChecked={value?.needs_1099 ?? false} className="size-4 accent-[#b58b4b]" />
        {t("vendors.needs1099")}
      </label>
      {withActive && (
        <label className="flex items-center gap-2 text-[13px]">
          <input type="checkbox" name="active" defaultChecked={value?.active ?? true} className="size-4 accent-[#b58b4b]" />
          {t("vendors.active")}
        </label>
      )}
    </>
  );
}

export function VendorForm({ today }: { today: string }) {
  const t = useTranslations("expenses");
  const { version, state, pending, onSubmit } = useSubmit(addVendor, true);
  return (
    <form key={version} onSubmit={onSubmit} className="grid gap-3 sm:grid-cols-4">
      <VendorFields prefix="new" value={null} today={today} withActive={false} />
      <div className="flex items-center gap-4 sm:col-span-3">
        <Button type="submit" size="sm" disabled={pending}>
          {t("vendors.add")}
        </Button>
        <Feedback state={state} />
      </div>
    </form>
  );
}

export function VendorEdit({ vendor, today, canDelete }: { vendor: VendorValues & { id: string }; today: string; canDelete: boolean }) {
  const t = useTranslations("expenses");
  const { state, pending, onSubmit } = useSubmit(updateVendor, false);
  const [removed, remove, removing] = useActionState<VendorState, FormData>(deleteVendor, {});
  return (
    <div className="grid gap-3">
      <form onSubmit={onSubmit} className="grid gap-3 sm:grid-cols-4">
        <input type="hidden" name="id" value={vendor.id} />
        <VendorFields prefix={vendor.id} value={vendor} today={today} withActive />
        <div className="flex items-center gap-4 sm:col-span-2">
          <Button type="submit" size="sm" disabled={pending}>
            {t("vendors.save")}
          </Button>
          <Feedback state={state} />
        </div>
      </form>
      {canDelete && (
        <form action={remove} className="flex items-center gap-3">
          <input type="hidden" name="id" value={vendor.id} />
          <button type="submit" disabled={removing} onClick={(event) => !confirm(t("vendors.confirmDelete")) && event.preventDefault()} className="text-[12px] text-muted hover:text-status-danger">
            {t("vendors.delete")}
          </button>
          <Feedback state={removed} />
        </form>
      )}
    </div>
  );
}
