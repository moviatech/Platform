"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Field";
import { placeHold, releaseHold, type HoldState } from "./hold-actions";

function Feedback({ state }: { state: HoldState }) {
  const t = useTranslations("investors.holds");
  if (state.error) return <span className="text-[12px] text-status-danger">{t(`errors.${state.error}`)}</span>;
  if (state.ok) return <span className="text-[12px] text-status-available">✓</span>;
  return null;
}

export function PlaceHoldForm({ scope, target, compact }: { scope: "ENTRY" | "VEHICLE" | "INVESTOR"; target: string; compact?: boolean }) {
  const t = useTranslations("investors.holds");
  const [state, action, pending] = useActionState<HoldState, FormData>(placeHold, {});
  if (state.ok) return <span className="text-[12px] text-status-available">{t("placed")}</span>;
  return (
    <form action={action} className={compact ? "flex flex-nowrap items-center gap-2" : "flex flex-wrap items-center gap-2"}>
      <input type="hidden" name="scope" value={scope} />
      <input type="hidden" name="target" value={target} />
      <Input name="reason" required minLength={2} maxLength={1000} placeholder={t("reason")} aria-label={t("reason")} className={compact ? "h-8 w-40 text-[12px]" : "h-9 w-64"} />
      <Button type="submit" size="sm" variant="secondary" className={compact ? "h-8" : undefined} disabled={pending}>
        {t("place")}
      </Button>
      <Feedback state={state} />
    </form>
  );
}

export function ReleaseHoldForm({ id, compact }: { id: string; compact?: boolean }) {
  const t = useTranslations("investors.holds");
  const [state, action, pending] = useActionState<HoldState, FormData>(releaseHold, {});
  if (state.ok) return <span className="text-[12px] text-status-available">{t("released")}</span>;
  return (
    <form action={action} className={compact ? "flex flex-nowrap items-center gap-2" : "flex flex-wrap items-center gap-2"}>
      <input type="hidden" name="id" value={id} />
      <Input name="note" maxLength={1000} placeholder={t("releaseNote")} aria-label={t("releaseNote")} className={compact ? "h-8 w-40 text-[12px]" : "h-8 w-48 text-[12px]"} />
      <Button type="submit" size="sm" variant="gold" className="h-8" disabled={pending}>
        {t("release")}
      </Button>
      <Feedback state={state} />
    </form>
  );
}
