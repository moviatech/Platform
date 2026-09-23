"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/Button";
import { FieldWrap, Select } from "@/components/ui/Field";
import { manageConversation, type ManageState } from "./actions";
import { conversationStatuses, mailboxes, type Conversation } from "./types";

type Props = {
  conversation: Pick<Conversation, "id" | "status" | "assigned_to" | "mailbox">;
  staff: Array<{ user_id: string; display_name: string }>;
  editable: boolean;
  domain: string;
};

export function ManagePanel({ conversation, staff, editable, domain }: Props) {
  const t = useTranslations("inbox");
  const common = useTranslations("common");
  const [state, action, pending] = useActionState<ManageState, FormData>(manageConversation, {});

  return (
    <form action={action} className="flex flex-col gap-3.5">
      <input type="hidden" name="conversationId" value={conversation.id} />
      <FieldWrap label={t("panel.status")} htmlFor="status">
        <Select id="status" name="status" defaultValue={conversation.status} disabled={!editable}>
          {conversationStatuses.map((status) => (
            <option key={status} value={status}>
              {t(`status.${status}`)}
            </option>
          ))}
        </Select>
      </FieldWrap>
      <FieldWrap label={t("panel.assignee")} htmlFor="assignedTo">
        <Select id="assignedTo" name="assignedTo" defaultValue={conversation.assigned_to ?? ""} disabled={!editable}>
          <option value="">{t("panel.unassigned")}</option>
          {staff.map((member) => (
            <option key={member.user_id} value={member.user_id}>
              {member.display_name}
            </option>
          ))}
        </Select>
      </FieldWrap>
      <FieldWrap label={t("panel.mailbox")} htmlFor="mailbox" hint={t("panel.mailboxHint")}>
        <Select id="mailbox" name="mailbox" defaultValue={conversation.mailbox} disabled={!editable}>
          {mailboxes.map((mailbox) => (
            <option key={mailbox} value={mailbox}>
              {mailbox}@{domain}
            </option>
          ))}
        </Select>
      </FieldWrap>
      {editable && (
        <div className="flex items-center gap-3">
          <Button type="submit" size="sm" variant="secondary" disabled={pending}>
            {common("save")}
          </Button>
          {state.ok && <span className="text-xs text-status-available">{common("saved")}</span>}
        </div>
      )}
    </form>
  );
}
