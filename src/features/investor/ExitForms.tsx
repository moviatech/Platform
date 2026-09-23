"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/Button";
import { FieldWrap, Input, Textarea } from "@/components/ui/Field";
import { cancelExit, requestExit, updateExit, type ExitState } from "./exit-actions";

export function RequestExitForm({ allocationId }: { allocationId: string }) {
  const t = useTranslations("investor.asset.exit");
  const [state, action, pending] = useActionState<ExitState, FormData>(requestExit, {});
  if (state.ok) return <p className="rounded-xl bg-status-available/10 px-4 py-3 text-[13px]">{t("submitted")}</p>;
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="allocationId" value={allocationId} />
      <FieldWrap label={t("reason")} htmlFor="exitReason">
        <Textarea id="exitReason" name="reason" maxLength={1000} className="min-h-20" />
      </FieldWrap>
      {state.error && (
        <p className="rounded-xl bg-status-danger/8 px-3.5 py-2.5 text-[13px] text-status-danger" role="alert">
          {t(`errors.${state.error}`)}
        </p>
      )}
      <div>
        <Button type="submit" size="sm" variant="danger" disabled={pending} onClick={(event) => !confirm(t("confirm")) && event.preventDefault()}>
          {t("submit")}
        </Button>
      </div>
    </form>
  );
}

export function CancelExitButton({ id }: { id: string }) {
  const t = useTranslations("investor.asset.exit");
  const [state, action, pending] = useActionState<ExitState, FormData>(cancelExit, {});
  if (state.ok) return <span className="text-[12px] text-muted">{t("cancelled")}</span>;
  return (
    <form action={action}>
      <input type="hidden" name="id" value={id} />
      <button type="submit" disabled={pending} className="text-[12px] text-muted hover:text-status-danger">
        {t("cancel")}
      </button>
    </form>
  );
}

export function ExitStatusForm({ id }: { id: string }) {
  const t = useTranslations("investors.exits");
  const [state, action, pending] = useActionState<ExitState, FormData>(updateExit, {});
  if (state.ok) return <span className="text-[12px] text-status-available">✓</span>;
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="id" value={id} />
      <Input name="note" maxLength={1000} placeholder={t("note")} className="h-8 w-44 text-[12px]" />
      <Button type="submit" name="status" value="IN_PROGRESS" size="sm" variant="secondary" className="h-8" disabled={pending}>
        {t("inProgress")}
      </Button>
      <Button type="submit" name="status" value="DECLINED" size="sm" variant="danger" className="h-8" disabled={pending} onClick={(event) => !confirm(t("confirmDecline")) && event.preventDefault()}>
        {t("decline")}
      </Button>
      {state.error && <span className="text-[12px] text-status-danger">{t(`errors.${state.error}`)}</span>}
    </form>
  );
}
