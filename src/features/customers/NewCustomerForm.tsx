"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/Button";
import { FieldWrap, Input, Select, Textarea } from "@/components/ui/Field";
import { createCustomer, type CustomerFormState } from "./actions";

export function NewCustomerForm() {
  const t = useTranslations("customers");
  const [state, action, pending] = useActionState<CustomerFormState, FormData>(createCustomer, {});

  return (
    <form action={action} className="grid gap-4 sm:grid-cols-2">
      <FieldWrap label={t("fields.name")} htmlFor="fullName">
        <Input id="fullName" name="fullName" required maxLength={120} autoFocus />
      </FieldWrap>
      <FieldWrap label={t("fields.phone")} htmlFor="phone">
        <Input id="phone" name="phone" type="tel" maxLength={40} />
      </FieldWrap>
      <FieldWrap label={t("fields.email")} htmlFor="email">
        <Input id="email" name="email" type="email" maxLength={200} />
      </FieldWrap>
      <FieldWrap label={t("fields.wechat")} htmlFor="wechat">
        <Input id="wechat" name="wechat" maxLength={60} />
      </FieldWrap>
      <FieldWrap label={t("fields.language")} htmlFor="language">
        <Select id="language" name="language" defaultValue="zh">
          <option value="zh">中文</option>
          <option value="en">English</option>
        </Select>
      </FieldWrap>
      <FieldWrap label={t("fields.dob")} htmlFor="dateOfBirth">
        <Input id="dateOfBirth" name="dateOfBirth" type="date" />
      </FieldWrap>
      <FieldWrap label={t("fields.notes")} htmlFor="internalNotes" hint={t("fields.notesHint")} className="sm:col-span-2">
        <Textarea id="internalNotes" name="internalNotes" maxLength={4000} className="min-h-20" />
      </FieldWrap>
      <div className="flex items-center gap-3 sm:col-span-2">
        <Button type="submit" disabled={pending}>
          {t("create")}
        </Button>
        {state.error && (
          <span className="text-[13px] text-status-danger" role="alert">
            {t(`errors.${state.error}`)}
          </span>
        )}
      </div>
    </form>
  );
}
