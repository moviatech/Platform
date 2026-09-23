"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/Button";
import { FieldWrap, Input, Select } from "@/components/ui/Field";
import { addBlock, type FleetFormState } from "./actions";
import { blockTypes } from "./types";

export function BlockForm({ vehicleId, today }: { vehicleId: string; today: string }) {
  const t = useTranslations("fleet");
  const [state, action, pending] = useActionState<FleetFormState, FormData>(addBlock, {});

  return (
    <form action={action} key={state.ok ? "done" : "form"} className="grid gap-3">
      <input type="hidden" name="vehicleId" value={vehicleId} />
      <FieldWrap label={t("blocks.from")} htmlFor="startDate">
        <div className="flex gap-2">
          <div className="min-w-0 flex-1">
            <Input id="startDate" name="startDate" type="date" defaultValue={today} required />
          </div>
          <div className="w-[6.75rem] shrink-0">
            <Input name="startTime" type="time" defaultValue="08:00" required className="px-2" aria-label={t("blocks.from")} />
          </div>
        </div>
      </FieldWrap>
      <FieldWrap label={t("blocks.to")} htmlFor="endDate">
        <div className="flex gap-2">
          <div className="min-w-0 flex-1">
            <Input id="endDate" name="endDate" type="date" defaultValue={today} required />
          </div>
          <div className="w-[6.75rem] shrink-0">
            <Input name="endTime" type="time" defaultValue="20:00" required className="px-2" aria-label={t("blocks.to")} />
          </div>
        </div>
      </FieldWrap>
      <FieldWrap label={t("blocks.type")} htmlFor="type">
        <Select id="type" name="type" defaultValue="MAINTENANCE">
          {blockTypes.map((item) => (
            <option key={item} value={item}>
              {t(`blockType.${item}`)}
            </option>
          ))}
        </Select>
      </FieldWrap>
      <FieldWrap label={t("blocks.reason")} htmlFor="reason">
        <Input id="reason" name="reason" maxLength={300} />
      </FieldWrap>
      <div className="flex items-center gap-3">
        <Button type="submit" size="sm" variant="secondary" disabled={pending}>
          {t("blocks.add")}
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
