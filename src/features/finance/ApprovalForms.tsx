"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Field";
import { decideApproval, type ApprovalState } from "./approval-actions";

export function ApprovalDecision({ approvalId }: { approvalId: string }) {
  const t = useTranslations("approvals");
  const p = useTranslations("payments");
  const [state, action, pending] = useActionState<ApprovalState, FormData>(decideApproval, {});
  if (state.ok) return <span className="text-[12px] text-status-available">✓</span>;
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="approvalId" value={approvalId} />
      <Input name="note" maxLength={500} placeholder={t("note")} className="h-8 w-44 text-[13px]" />
      <Button type="submit" name="decision" value="approve" size="sm" disabled={pending}>
        {t("approve")}
      </Button>
      <Button type="submit" name="decision" value="decline" size="sm" variant="danger" disabled={pending}>
        {t("decline")}
      </Button>
      {state.error && <span className="text-[12px] text-status-danger">{p.has(`errors.${state.error}`) ? p(`errors.${state.error}`) : state.error}</span>}
    </form>
  );
}
