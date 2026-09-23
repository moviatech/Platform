"use client";

import { useActionState, useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/Button";
import { FieldWrap, Select, Textarea } from "@/components/ui/Field";
import { useAttachmentSubmit } from "./AttachmentField";
import { Icon } from "./icons";
import { createRequest, replyRequest } from "./request-actions";
import { requestTypes, type RequestState, type RequestType } from "./request-types";

function ErrorText({ code }: { code?: string }) {
  const t = useTranslations("portal.help");
  if (!code) return null;
  return (
    <p className="text-[13px] text-status-danger" role="alert">
      {t.has(`errors.${code}`) ? t(`errors.${code}`) : code}
    </p>
  );
}

type Props = { trips: Array<{ number: string; label: string }>; defaultType?: string; defaultTrip?: string };

export function RequestForm({ trips, defaultType, defaultTrip }: Props) {
  const t = useTranslations("portal.help");
  const [state, action, pending] = useActionState<RequestState, FormData>(createRequest, {});
  const attachments = useAttachmentSubmit(action);
  const initial = (requestTypes as readonly string[]).includes(defaultType ?? "") ? (defaultType as RequestType) : "schedule";
  return (
    <form onSubmit={attachments.onSubmit} className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <FieldWrap label={t("requestType")} htmlFor="type">
          <Select id="type" name="type" defaultValue={initial}>
            {requestTypes.map((type) => (
              <option key={type} value={type}>
                {t(`types.${type}`)}
              </option>
            ))}
          </Select>
        </FieldWrap>
        <FieldWrap label={t("requestTrip")} htmlFor="trip">
          <Select id="trip" name="trip" defaultValue={trips.some((trip) => trip.number === defaultTrip) ? defaultTrip : ""}>
            <option value="">—</option>
            {trips.map((trip) => (
              <option key={trip.number} value={trip.number}>
                {trip.label}
              </option>
            ))}
          </Select>
        </FieldWrap>
      </div>
      <FieldWrap label={t("requestMessage")} htmlFor="message">
        <Textarea id="message" name="message" required minLength={5} maxLength={3000} />
      </FieldWrap>
      {attachments.field}
      <div>
        <Button type="submit" variant="gold" disabled={pending || attachments.uploading}>
          {t("send")}
        </Button>
      </div>
      <ErrorText code={attachments.error ?? state.error} />
    </form>
  );
}

export function ReplyForm({ conversationId }: { conversationId: string }) {
  const t = useTranslations("portal.messages");
  const [state, action, pending] = useActionState<RequestState, FormData>(replyRequest, {});
  const [key, setKey] = useState(0);
  const attachments = useAttachmentSubmit((form) => {
    action(form);
    setKey((value) => value + 1);
  });
  return (
    <form key={key} onSubmit={attachments.onSubmit} className="flex flex-col gap-2">
      <input type="hidden" name="conversationId" value={conversationId} />
      <div className="flex items-end gap-2">
        {attachments.compact}
        <Textarea name="message" required maxLength={3000} rows={1} placeholder={t("typeMessage")} className="min-h-10 flex-1 resize-none rounded-pill px-4 py-2.5" aria-label={t("reply")} />
        <Button type="submit" variant="gold" size="sm" disabled={pending || attachments.uploading} className="size-10 rounded-full px-0" aria-label={t("send")}>
          <Icon name="send" size={16} />
        </Button>
      </div>
      {state.ok && <span className="text-[12px] text-status-available">{t("replied")}</span>}
      <ErrorText code={attachments.error ?? state.error} />
    </form>
  );
}

export function QuickRequestForm({ type, message, label }: { type: RequestType; message: string; label: string }) {
  const t = useTranslations("portal.help");
  const [state, action, pending] = useActionState<RequestState, FormData>(createRequest, {});
  return (
    <form action={action} className="flex flex-col items-end gap-2">
      <input type="hidden" name="type" value={type} />
      <input type="hidden" name="message" value={message} />
      <Button type="submit" variant="danger" size="sm" disabled={pending}>
        {label}
      </Button>
      {state.ok && <span className="text-[12px] text-status-available">{t("sent")}</span>}
      <ErrorText code={state.error} />
    </form>
  );
}

export function CopyButton({ value, label, copied, variant = "secondary" }: { value: string; label: string; copied: string; variant?: "secondary" | "gold" }) {
  const [done, setDone] = useState(false);
  return (
    <Button
      type="button"
      size="sm"
      variant={variant}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setDone(true);
          setTimeout(() => setDone(false), 2000);
        } catch {}
      }}
    >
      <Icon name={variant === "gold" ? "doc" : "arrow"} size={14} />
      {done ? copied : label}
    </Button>
  );
}
