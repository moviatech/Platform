"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/Button";
import { FieldWrap, Input, Select, Textarea } from "@/components/ui/Field";
import type { FleetFormState } from "./actions";
import { addServiceLog } from "./service-actions";
import { serviceKinds } from "./types";

export function ServiceLogForm({ vehicleId, today }: { vehicleId: string; today: string }) {
  const t = useTranslations("fleet");
  const [state, action, pending] = useActionState<FleetFormState, FormData>(addServiceLog, {});
  return (
    <form action={action} key={state.ok ? "done" : "form"} className="grid gap-3 sm:grid-cols-2">
      <input type="hidden" name="vehicleId" value={vehicleId} />
      <FieldWrap label={t("service.kind")} htmlFor="serviceKind">
        <Select id="serviceKind" name="kind" defaultValue="MAINTENANCE">
          {serviceKinds.map((kind) => (
            <option key={kind} value={kind}>
              {t(`service.kinds.${kind}`)}
            </option>
          ))}
        </Select>
      </FieldWrap>
      <FieldWrap label={t("service.date")} htmlFor="performedOn">
        <Input id="performedOn" name="performedOn" type="date" defaultValue={today} required />
      </FieldWrap>
      <FieldWrap label={t("service.odometer")} htmlFor="serviceOdometer">
        <Input id="serviceOdometer" name="odometer" type="number" inputMode="numeric" min={0} />
      </FieldWrap>
      <FieldWrap label={t("service.cost")} htmlFor="serviceCost">
        <Input id="serviceCost" name="cost" inputMode="decimal" />
      </FieldWrap>
      <FieldWrap label={t("service.vendor")} htmlFor="serviceVendor" className="sm:col-span-2">
        <Input id="serviceVendor" name="vendor" maxLength={120} />
      </FieldWrap>
      <FieldWrap label={t("service.notes")} htmlFor="serviceNotes" className="sm:col-span-2">
        <Textarea id="serviceNotes" name="notes" maxLength={2000} className="min-h-16" />
      </FieldWrap>
      <div className="flex items-center gap-3 sm:col-span-2">
        <Button type="submit" size="sm" variant="secondary" disabled={pending}>
          {t("service.add")}
        </Button>
        {state.error && <span className="text-[12px] text-status-danger">{t(`errors.${state.error}`)}</span>}
      </div>
    </form>
  );
}
