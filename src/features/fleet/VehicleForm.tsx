"use client";

import { useActionState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Button } from "@/components/ui/Button";
import { FieldWrap, Input, Select, Textarea } from "@/components/ui/Field";
import { saveVehicle, type FleetFormState } from "./actions";
import { cleanStates, vehicleConditions, type ClassOption, type VehicleRow } from "./types";

type Props = { vehicle?: VehicleRow; classes: ClassOption[]; editable: boolean };

export function VehicleForm({ vehicle, classes, editable }: Props) {
  const t = useTranslations("fleet");
  const common = useTranslations("common");
  const locale = useLocale();
  const [state, action, pending] = useActionState<FleetFormState, FormData>(saveVehicle, {});

  return (
    <form action={action} className="grid gap-4 sm:grid-cols-2">
      <input type="hidden" name="id" value={vehicle?.id ?? ""} />
      <FieldWrap label={t("fields.fleetNumber")} htmlFor="fleetNumber">
        <Input id="fleetNumber" name="fleetNumber" defaultValue={vehicle?.fleet_number ?? ""} required maxLength={20} disabled={!editable} />
      </FieldWrap>
      <FieldWrap label={t("fields.class")} htmlFor="classId">
        <Select id="classId" name="classId" defaultValue={vehicle?.class_id ?? classes[0]?.id} disabled={!editable}>
          {classes.map((item) => (
            <option key={item.id} value={item.id}>
              {locale === "zh" ? (item.name_zh ?? item.name) : item.name}
            </option>
          ))}
        </Select>
      </FieldWrap>
      <FieldWrap label={t("fields.condition")} htmlFor="condition">
        <Select id="condition" name="condition" defaultValue={vehicle?.condition ?? "IN_SERVICE"} disabled={!editable}>
          {vehicleConditions.map((item) => (
            <option key={item} value={item}>
              {t(`condition.${item}`)}
            </option>
          ))}
        </Select>
      </FieldWrap>
      <FieldWrap label={t("fields.cleanState")} htmlFor="cleanState">
        <Select id="cleanState" name="cleanState" defaultValue={vehicle?.clean_state ?? "READY"} disabled={!editable}>
          {cleanStates.map((item) => (
            <option key={item} value={item}>
              {t(`clean.${item}`)}
            </option>
          ))}
        </Select>
      </FieldWrap>
      <FieldWrap label={t("fields.battery")} htmlFor="batteryLevel">
        <Input id="batteryLevel" name="batteryLevel" type="number" min={0} max={100} defaultValue={vehicle?.battery_level ?? ""} disabled={!editable} />
      </FieldWrap>
      <FieldWrap label={t("fields.odometer")} htmlFor="odometer">
        <Input id="odometer" name="odometer" type="number" min={0} defaultValue={vehicle?.odometer ?? ""} disabled={!editable} />
      </FieldWrap>
      <FieldWrap label="VIN" htmlFor="vin">
        <Input id="vin" name="vin" defaultValue={vehicle?.vin ?? ""} maxLength={17} disabled={!editable} />
      </FieldWrap>
      <FieldWrap label={t("fields.plate")} htmlFor="licensePlate">
        <Input id="licensePlate" name="licensePlate" defaultValue={vehicle?.license_plate ?? ""} maxLength={12} disabled={!editable} />
      </FieldWrap>
      <FieldWrap label={t("fields.year")} htmlFor="year">
        <Input id="year" name="year" type="number" min={2015} max={2035} defaultValue={vehicle?.year ?? ""} disabled={!editable} />
      </FieldWrap>
      <FieldWrap label={t("fields.color")} htmlFor="exteriorColor">
        <Input id="exteriorColor" name="exteriorColor" defaultValue={vehicle?.exterior_color ?? ""} maxLength={40} disabled={!editable} />
      </FieldWrap>
      <FieldWrap label={t("fields.notes")} htmlFor="notes" className="sm:col-span-2">
        <Textarea id="notes" name="notes" defaultValue={vehicle?.notes ?? ""} maxLength={2000} disabled={!editable} />
      </FieldWrap>
      <label className="flex items-center gap-2.5 text-[13px] text-charcoal sm:col-span-2">
        <input type="checkbox" name="isPlaceholder" defaultChecked={vehicle?.is_placeholder ?? false} disabled={!editable} className="size-4 accent-[#b58b4b]" />
        {t("fields.placeholder")}
      </label>
      {editable && (
        <div className="flex items-center gap-3 sm:col-span-2">
          <Button type="submit" disabled={pending}>
            {common("save")}
          </Button>
          {state.ok && <span className="text-[13px] text-status-available">{common("saved")}</span>}
          {state.error && (
            <span className="text-[13px] text-status-danger" role="alert">
              {t(`errors.${state.error}`)}
            </span>
          )}
        </div>
      )}
    </form>
  );
}
