"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/Button";
import { Input, Select } from "@/components/ui/Field";
import { adjustmentKinds } from "./mileage-kinds";
import { addStatementAdjustment, enterReading, generateStatements, issueStatementAction, removeStatementAdjustment, rereadOdometer, resolveStatementDispute, voidStatementAction, type MileageState } from "./mileage-actions";

function Feedback({ state }: { state: MileageState }) {
  const t = useTranslations("investors.mileage");
  if (state.error) return <span className="text-[12px] text-status-danger">{t.has(`errors.${state.error}`) ? t(`errors.${state.error}`) : t.has(`readErrors.${state.error}`) ? t(`readErrors.${state.error}`) : `${t("errors.failed")} (${state.error})`}</span>;
  if (state.ok) return <span className="text-[12px] text-status-available">✓</span>;
  return null;
}

export function GenerateForm({ month }: { month: string }) {
  const t = useTranslations("investors.mileage");
  const [state, action, pending] = useActionState<MileageState, FormData>(generateStatements, {});
  return (
    <form action={action} className="flex items-center gap-2">
      <input type="hidden" name="month" value={month} />
      <Button type="submit" size="sm" variant="secondary" disabled={pending} onClick={(event) => !confirm(t("confirmGenerate", { month })) && event.preventDefault()}>
        {t("generate")}
      </Button>
      {state.ok ? <span className="text-[12px] text-muted">{t("generated", { created: state.created ?? 0, issued: state.issued ?? 0, drafts: state.drafts ?? 0 })}</span> : <Feedback state={state} />}
    </form>
  );
}

export function RereadButton({ id }: { id: string }) {
  const t = useTranslations("investors.mileage");
  const [state, action, pending] = useActionState<MileageState, FormData>(rereadOdometer, {});
  return (
    <form action={action} className="flex items-center gap-2">
      <input type="hidden" name="id" value={id} />
      <Button type="submit" size="sm" variant="secondary" className="h-8" disabled={pending}>
        {pending ? t("rereading") : t("reread")}
      </Button>
      {state.ok ? <span className="text-[12px] text-status-available">{t("readOk")}</span> : <Feedback state={state} />}
    </form>
  );
}

export function ReadingForm({ id, which, defaultValue }: { id: string; which: "start" | "end"; defaultValue: number | null }) {
  const t = useTranslations("investors.mileage");
  const [state, action, pending] = useActionState<MileageState, FormData>(enterReading, {});
  return (
    <form action={action} className="flex items-center gap-2">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="which" value={which} />
      <Input name="reading" inputMode="numeric" required defaultValue={defaultValue ?? ""} placeholder={which === "start" ? t("startReading") : t("endReading")} aria-label={which === "start" ? t("startReading") : t("endReading")} className="h-8 w-32 text-[12px]" />
      <Button type="submit" size="sm" variant="secondary" className="h-8" disabled={pending}>
        {t("saveReading")}
      </Button>
      <Feedback state={state} />
    </form>
  );
}

export function AdjustmentForm({ id }: { id: string }) {
  const t = useTranslations("investors.mileage");
  const [state, action, pending] = useActionState<MileageState, FormData>(addStatementAdjustment, {});
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="id" value={id} />
      <Input name="miles" inputMode="numeric" required placeholder={t("adjustMiles")} aria-label={t("adjustMiles")} className="h-8 w-32 text-[12px]" />
      <Select name="kind" defaultValue="OWNER_USE" aria-label={t("adjustKind")} className="h-8 w-36 text-[12px]">
        {adjustmentKinds
          .filter((kind) => kind !== "DISPUTE")
          .map((kind) => (
            <option key={kind} value={kind}>
              {t(`kinds.${kind}`)}
            </option>
          ))}
      </Select>
      <Input name="reason" required minLength={2} maxLength={500} placeholder={t("adjustReason")} aria-label={t("adjustReason")} className="h-8 w-56 text-[12px]" />
      <Button type="submit" size="sm" variant="secondary" className="h-8" disabled={pending}>
        {t("add")}
      </Button>
      <Feedback state={state} />
    </form>
  );
}

export function RemoveAdjustmentButton({ id }: { id: string }) {
  const t = useTranslations("investors.mileage");
  const [state, action, pending] = useActionState<MileageState, FormData>(removeStatementAdjustment, {});
  if (state.ok) return null;
  return (
    <form action={action} className="inline-flex items-center gap-1">
      <input type="hidden" name="id" value={id} />
      <button type="submit" disabled={pending} className="text-[12px] text-muted hover:text-status-danger">
        {t("remove")}
      </button>
      <Feedback state={state} />
    </form>
  );
}

export function IssueButton({ id }: { id: string }) {
  const t = useTranslations("investors.mileage");
  const [state, action, pending] = useActionState<MileageState, FormData>(issueStatementAction, {});
  if (state.ok) return <span className="text-[12px] text-status-available">{t("issued")}</span>;
  return (
    <form action={action} className="flex items-center gap-2">
      <input type="hidden" name="id" value={id} />
      <Button type="submit" size="sm" variant="gold" className="h-8" disabled={pending} onClick={(event) => !confirm(t("confirmIssue")) && event.preventDefault()}>
        {t("issue")}
      </Button>
      <Feedback state={state} />
    </form>
  );
}

export function VoidButton({ id }: { id: string }) {
  const t = useTranslations("investors.mileage");
  const [state, action, pending] = useActionState<MileageState, FormData>(voidStatementAction, {});
  if (state.ok) return <span className="text-[12px] text-muted">{t("status.VOID")}</span>;
  return (
    <form action={action} className="flex items-center gap-2">
      <input type="hidden" name="id" value={id} />
      <button type="submit" disabled={pending} onClick={(event) => !confirm(t("confirmVoid")) && event.preventDefault()} className="text-[12px] text-muted hover:text-status-danger">
        {t("void")}
      </button>
      <Feedback state={state} />
    </form>
  );
}

export function ResolveForm({ id, disputedMiles }: { id: string; disputedMiles: number }) {
  const t = useTranslations("investors.mileage");
  const [state, action, pending] = useActionState<MileageState, FormData>(resolveStatementDispute, {});
  if (state.ok) return <span className="text-[12px] text-status-available">{t("resolved")}</span>;
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="id" value={id} />
      <Input name="accepted" inputMode="numeric" required defaultValue={disputedMiles} min={0} max={disputedMiles} type="number" aria-label={t("acceptedMiles")} title={t("acceptedMiles")} className="h-8 w-28 text-[12px]" />
      <Input name="note" required minLength={2} maxLength={1000} placeholder={t("resolveNote")} aria-label={t("resolveNote")} className="h-8 w-64 text-[12px]" />
      <Button type="submit" size="sm" variant="gold" className="h-8" disabled={pending}>
        {t("resolve")}
      </Button>
      <Feedback state={state} />
    </form>
  );
}
