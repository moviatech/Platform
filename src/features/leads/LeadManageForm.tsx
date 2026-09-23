"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/Button";
import { FieldWrap, Select, Textarea } from "@/components/ui/Field";
import { updateLead, type LeadFormState } from "./actions";
import { leadStatuses, type Lead } from "./types";

export function LeadManageForm({ lead, editable }: { lead: Pick<Lead, "id" | "status" | "internal_notes">; editable: boolean }) {
  const t = useTranslations("leads");
  const common = useTranslations("common");
  const [state, action, pending] = useActionState<LeadFormState, FormData>(updateLead, {});

  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="id" value={lead.id} />
      <FieldWrap label={t("detail.status")} htmlFor="status">
        <Select id="status" name="status" defaultValue={lead.status} disabled={!editable}>
          {leadStatuses.map((status) => (
            <option key={status} value={status}>
              {t(`status.${status}`)}
            </option>
          ))}
        </Select>
      </FieldWrap>
      <FieldWrap label={t("detail.notes")} htmlFor="notes" hint={t("detail.notesHint")}>
        <Textarea id="notes" name="notes" defaultValue={lead.internal_notes ?? ""} maxLength={4000} disabled={!editable} />
      </FieldWrap>
      {editable && (
        <div className="flex items-center gap-3">
          <Button type="submit" disabled={pending}>
            {common("save")}
          </Button>
          {state.ok && <span className="text-[13px] text-status-available">{common("saved")}</span>}
          {state.error && <span className="text-[13px] text-status-danger">!</span>}
        </div>
      )}
    </form>
  );
}
