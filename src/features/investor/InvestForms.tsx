"use client";

import { useActionState, useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/Button";
import { FieldWrap, Input, Textarea } from "@/components/ui/Field";
import { MoneyInput } from "@/components/ui/FormattedInput";
import { Icon } from "@/features/portal/icons";
import { cn } from "@/lib/utils/cn";
import { requestCapital, requestVehicle, type ContributionState } from "./contribution-actions";

function Feedback({ state }: { state: ContributionState }) {
  const t = useTranslations("investor.invest");
  if (!state.error) return null;
  return (
    <p className="rounded-xl bg-status-danger/8 px-3.5 py-2.5 text-[13px] text-status-danger" role="alert">
      {t(`errors.${state.error}`)}
    </p>
  );
}

export function InvestForm({ availableLabel, minLabel }: { availableLabel: string; minLabel: string }) {
  const t = useTranslations("investor.invest");
  const [kind, setKind] = useState<"CAPITAL" | "VEHICLE">("CAPITAL");
  const [capital, capitalAction, capitalPending] = useActionState<ContributionState, FormData>(requestCapital, {});
  const [vehicle, vehicleAction, vehiclePending] = useActionState<ContributionState, FormData>(requestVehicle, {});
  const option = (value: "CAPITAL" | "VEHICLE", icon: "coins" | "car", title: string, body: string) => (
    <button type="button" onClick={() => setKind(value)} aria-pressed={kind === value} className={cn("relative flex flex-col items-start gap-3 rounded-xl border p-5 text-left transition-colors", kind === value ? "border-gold bg-gold/[0.06]" : "border-ink/10 bg-white hover:border-ink/25")}>
      <span className={cn("absolute top-4 right-4 flex size-6 items-center justify-center rounded-full", kind === value ? "bg-gold text-white" : "border border-ink/15")}>{kind === value && <Icon name="check" size={13} />}</span>
      <Icon name={icon} size={30} className="text-gold" />
      <span>
        <span className="block text-[19px] font-semibold tracking-tight">{title}</span>
        <span className="block text-[13px] text-muted">{body}</span>
      </span>
    </button>
  );
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
      <section className="card p-6">
        <h2 className="mb-4 text-[17px] font-semibold tracking-tight">{t("chooseTitle")}</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          {option("CAPITAL", "coins", t("capitalTitle"), t("capitalBody"))}
          {option("VEHICLE", "car", t("vehicleTitle"), t("vehicleBody"))}
        </div>
        <div className="mt-6 rounded-xl bg-[#f7f4ee] p-5">
          <p className="text-[13px] text-muted">{t("availableTitle")}</p>
          <p className="mt-1 text-[2rem] leading-tight font-semibold tracking-tight">{availableLabel}</p>
          <p className="mt-2 text-[13px] text-charcoal">{t("availableBody")}</p>
        </div>
      </section>
      <section className="card p-6">
        {kind === "CAPITAL" ? (
          <form action={capitalAction} className="flex flex-col gap-4">
            <h2 className="text-[17px] font-semibold tracking-tight">{t("capitalFormTitle")}</h2>
            <FieldWrap label={t("amount")} htmlFor="amount" hint={minLabel}>
              <MoneyInput id="amount" name="amount" required placeholder="$" className="text-lg" />
            </FieldWrap>
            <FieldWrap label={t("note")} htmlFor="capitalNote">
              <Textarea id="capitalNote" name="note" maxLength={1000} className="min-h-20" />
            </FieldWrap>
            <label className="flex items-start gap-2.5 text-[13px] text-charcoal">
              <input type="checkbox" name="agree" value="1" required className="mt-0.5 size-4 accent-[#b58b4b]" />
              {t("agreeCapital")}
            </label>
            <Feedback state={capital} />
            <Button type="submit" size="lg" disabled={capitalPending} className="w-full">
              {t("submit")}
            </Button>
            <p className="text-center text-[12px] text-muted">{t("nextCapital")}</p>
          </form>
        ) : (
          <form action={vehicleAction} className="flex flex-col gap-4">
            <h2 className="text-[17px] font-semibold tracking-tight">{t("vehicleFormTitle")}</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <FieldWrap label={t("model")} htmlFor="model">
                <Input id="model" name="model" required maxLength={80} placeholder="Model Y Long Range" />
              </FieldWrap>
              <FieldWrap label={t("year")} htmlFor="year">
                <Input id="year" name="year" inputMode="numeric" required pattern="\d{4}" maxLength={4} />
              </FieldWrap>
              <FieldWrap label="VIN" htmlFor="vin" className="sm:col-span-2">
                <Input id="vin" name="vin" required minLength={11} maxLength={20} className="font-mono uppercase" />
              </FieldWrap>
              <FieldWrap label={t("plate")} htmlFor="plate">
                <Input id="plate" name="plate" maxLength={20} />
              </FieldWrap>
              <FieldWrap label={t("color")} htmlFor="color">
                <Input id="color" name="color" maxLength={40} />
              </FieldWrap>
              <FieldWrap label={t("mileage")} htmlFor="mileage">
                <Input id="mileage" name="mileage" inputMode="numeric" maxLength={7} />
              </FieldWrap>
            </div>
            <FieldWrap label={t("note")} htmlFor="vehicleNote">
              <Textarea id="vehicleNote" name="note" maxLength={1000} className="min-h-20" />
            </FieldWrap>
            <label className="flex items-start gap-2.5 text-[13px] text-charcoal">
              <input type="checkbox" name="agree" value="1" required className="mt-0.5 size-4 accent-[#b58b4b]" />
              {t("agreeVehicle")}
            </label>
            <Feedback state={vehicle} />
            <Button type="submit" size="lg" disabled={vehiclePending} className="w-full">
              {t("submit")}
            </Button>
            <p className="text-center text-[12px] text-muted">{t("nextVehicle")}</p>
          </form>
        )}
      </section>
    </div>
  );
}
