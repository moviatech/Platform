"use client";

import { useActionState, useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/Button";
import { FieldWrap, Input, Select, Textarea } from "@/components/ui/Field";
import { useAttachmentSubmit } from "./AttachmentField";
import { submitChangeRequest } from "./change-actions";
import { requestTypes, type RequestState, type RequestType } from "./request-types";

type Props = {
  number: string;
  defaultKind?: string;
  current: { pickupDate: string; pickupTime: string; returnDate: string; returnTime: string };
  slots: string[];
};

const kinds = requestTypes.filter((type) => type !== "issue");

export function ModifyForm({ number, defaultKind, current, slots }: Props) {
  const t = useTranslations("portal.modify");
  const types = useTranslations("portal.help.types");
  const [state, action, pending] = useActionState<RequestState, FormData>(submitChangeRequest, {});
  const initial = (kinds as readonly string[]).includes(defaultKind ?? "") ? (defaultKind as RequestType) : "schedule";
  const [kind, setKind] = useState<RequestType>(initial);
  const attachments = useAttachmentSubmit(action);
  const dated = kind === "schedule" || kind === "extend";
  const error = attachments.error ?? state.error;

  return (
    <form onSubmit={attachments.onSubmit} className="flex flex-col gap-5">
      <input type="hidden" name="number" value={number} />
      <FieldWrap label={t("kind")} htmlFor="kind">
        <Select id="kind" name="kind" value={kind} onChange={(event) => setKind(event.target.value as RequestType)}>
          {kinds.map((item) => (
            <option key={item} value={item}>
              {types(item)}
            </option>
          ))}
        </Select>
      </FieldWrap>
      {dated && (
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid grid-cols-[minmax(0,1fr)_7rem] gap-2">
            <FieldWrap label={t("newPickup")} htmlFor="pickupDate">
              <Input id="pickupDate" name="pickupDate" type="date" required defaultValue={current.pickupDate} />
            </FieldWrap>
            <div className="flex flex-col justify-end">
              <Select name="pickupTime" defaultValue={current.pickupTime} aria-label={t("newPickup")}>
                {slots.map((slot) => (
                  <option key={slot} value={slot}>
                    {slot}
                  </option>
                ))}
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-[minmax(0,1fr)_7rem] gap-2">
            <FieldWrap label={t("newReturn")} htmlFor="returnDate">
              <Input id="returnDate" name="returnDate" type="date" required defaultValue={current.returnDate} />
            </FieldWrap>
            <div className="flex flex-col justify-end">
              <Select name="returnTime" defaultValue={current.returnTime} aria-label={t("newReturn")}>
                {slots.map((slot) => (
                  <option key={slot} value={slot}>
                    {slot}
                  </option>
                ))}
              </Select>
            </div>
          </div>
        </div>
      )}
      {kind === "driver" && (
        <FieldWrap label={t("driverName")} htmlFor="driverName">
          <Input id="driverName" name="driverName" required maxLength={120} />
        </FieldWrap>
      )}
      <FieldWrap label={t("notes")} htmlFor="notes">
        <Textarea id="notes" name="notes" maxLength={3000} required={!dated && kind !== "driver"} className="min-h-24" />
      </FieldWrap>
      {attachments.field}
      <p className="text-[12px] text-muted">{dated ? t("policy") : t("subject")}</p>
      <div>
        <Button type="submit" variant="gold" disabled={pending || attachments.uploading}>
          {t("submit")}
        </Button>
      </div>
      {error && (
        <p className="text-[13px] text-status-danger" role="alert">
          {t.has(`errors.${error}`) ? t(`errors.${error}`) : error}
        </p>
      )}
    </form>
  );
}
