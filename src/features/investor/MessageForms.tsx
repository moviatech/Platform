"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/Button";
import { FieldWrap, Select, Textarea } from "@/components/ui/Field";
import { Icon } from "@/features/portal/icons";
import { createInvestorConversation, replyInvestorConversation, type MessageState } from "./message-actions";
import { topics } from "./message-types";

export function NewMessageForm({ defaultTopic }: { defaultTopic?: string }) {
  const t = useTranslations("investor.messages");
  const [state, action, pending] = useActionState<MessageState, FormData>(createInvestorConversation, {});
  return (
    <form action={action} className="flex flex-col gap-4">
      <FieldWrap label={t("topic")} htmlFor="topic">
        <Select id="topic" name="topic" defaultValue={(topics as readonly string[]).includes(defaultTopic ?? "") ? defaultTopic : "other"}>
          {topics.map((topic) => (
            <option key={topic} value={topic}>
              {t(`topics.${topic}`)}
            </option>
          ))}
        </Select>
      </FieldWrap>
      <FieldWrap label={t("message")} htmlFor="message">
        <Textarea id="message" name="message" required minLength={2} maxLength={3000} className="min-h-32" />
      </FieldWrap>
      {state.error && (
        <p className="rounded-xl bg-status-danger/8 px-3.5 py-2.5 text-[13px] text-status-danger" role="alert">
          {t(`errors.${state.error}`)}
        </p>
      )}
      <div>
        <Button type="submit" disabled={pending}>
          {t("send")}
        </Button>
      </div>
    </form>
  );
}

export function ReplyForm({ conversationId }: { conversationId: string }) {
  const t = useTranslations("investor.messages");
  const [state, action, pending] = useActionState<MessageState, FormData>(replyInvestorConversation, {});
  return (
    <form
      action={action}
      className="flex items-end gap-2"
      ref={(node) => {
        if (node && state.ok) node.reset();
      }}
    >
      <input type="hidden" name="conversationId" value={conversationId} />
      <Textarea name="message" required minLength={1} maxLength={3000} placeholder={t("typeMessage")} className="min-h-11 flex-1 resize-none py-2.5" rows={1} />
      <Button type="submit" size="md" disabled={pending} className="shrink-0" aria-label={t("send")}>
        <Icon name="send" size={16} />
      </Button>
      {state.error && <span className="text-[12px] text-status-danger">{t(`errors.${state.error}`)}</span>}
    </form>
  );
}
