"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/Button";
import { FieldWrap, Input, Textarea } from "@/components/ui/Field";
import { deleteLocation, saveLocation, type LocationFormState } from "./actions";
import type { LocationRow } from "./queries";

export function LocationForm({ location }: { location?: LocationRow }) {
  const t = useTranslations("locations");
  const common = useTranslations("common");
  const [state, action, pending] = useActionState<LocationFormState, FormData>(saveLocation, {});

  return (
    <form action={action} className="grid gap-4 sm:grid-cols-2">
      <input type="hidden" name="id" value={location?.id ?? ""} />
      <FieldWrap label={t("fields.name")} htmlFor="name">
        <Input id="name" name="name" defaultValue={location?.name ?? ""} required maxLength={80} />
      </FieldWrap>
      <FieldWrap label={t("fields.nameZh")} htmlFor="nameZh">
        <Input id="nameZh" name="nameZh" defaultValue={location?.name_zh ?? ""} maxLength={80} />
      </FieldWrap>
      <FieldWrap label={t("fields.address")} htmlFor="address" className="sm:col-span-2">
        <Input id="address" name="address" defaultValue={location?.address ?? ""} maxLength={300} />
      </FieldWrap>
      <FieldWrap label={t("fields.taxRate")} htmlFor="taxRate">
        <Input id="taxRate" name="taxRate" type="number" min={0} max={30} step={0.01} defaultValue={location ? (location.tax_rate_bps / 100).toString() : "7.75"} />
      </FieldWrap>
      <label className="flex items-center gap-2.5 self-end pb-3 text-[13px] text-charcoal">
        <input type="checkbox" name="active" defaultChecked={location?.active ?? true} className="size-4 accent-[#b58b4b]" />
        {t("fields.active")}
      </label>
      <FieldWrap label={t("fields.instructions")} htmlFor="pickupInstructions">
        <Textarea id="pickupInstructions" name="pickupInstructions" defaultValue={location?.pickup_instructions ?? ""} maxLength={1000} className="min-h-20" />
      </FieldWrap>
      <FieldWrap label={t("fields.instructionsZh")} htmlFor="pickupInstructionsZh">
        <Textarea id="pickupInstructionsZh" name="pickupInstructionsZh" defaultValue={location?.pickup_instructions_zh ?? ""} maxLength={1000} className="min-h-20" />
      </FieldWrap>
      <div className="flex items-center gap-3 sm:col-span-2">
        <Button type="submit" disabled={pending}>
          {common("save")}
        </Button>
        {state.error && (
          <span className="text-[13px] text-status-danger" role="alert">
            {t(`errors.${state.error}`)}
          </span>
        )}
      </div>
    </form>
  );
}

export function DeleteLocationButton({ id, disabled }: { id: string; disabled: boolean }) {
  const t = useTranslations("locations");
  return (
    <form
      action={deleteLocation}
      onSubmit={(event) => {
        if (!window.confirm(t("deleteConfirm"))) event.preventDefault();
      }}
    >
      <input type="hidden" name="id" value={id} />
      <Button type="submit" size="sm" variant="ghost" disabled={disabled}>
        {t("delete")}
      </Button>
    </form>
  );
}
