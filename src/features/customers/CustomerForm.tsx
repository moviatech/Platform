"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/Button";
import { FieldWrap, Input, Select, Textarea } from "@/components/ui/Field";
import { saveCustomer, type CustomerFormState } from "./actions";

export type CustomerRecord = {
  id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  wechat: string | null;
  preferred_language: string;
  date_of_birth: string | null;
  address: string | null;
  license_state: string | null;
  license_last4: string | null;
  license_expires_on: string | null;
  dnr_flag: boolean;
  dnr_reason: string | null;
  internal_notes: string | null;
  created_at: string;
};

export function CustomerForm({ customer, editable }: { customer: CustomerRecord; editable: boolean }) {
  const t = useTranslations("customers");
  const common = useTranslations("common");
  const [state, action, pending] = useActionState<CustomerFormState, FormData>(saveCustomer, {});

  return (
    <form action={action} className="grid gap-4 sm:grid-cols-2">
      <input type="hidden" name="id" value={customer.id} />
      <input type="hidden" name="wasDateOfBirth" value={customer.date_of_birth ?? ""} />
      <input type="hidden" name="wasAddress" value={customer.address ?? ""} />
      <input type="hidden" name="wasLicenseState" value={customer.license_state ?? ""} />
      <input type="hidden" name="wasLicenseLast4" value={customer.license_last4 ?? ""} />
      <input type="hidden" name="wasLicenseExpires" value={customer.license_expires_on ?? ""} />
      <FieldWrap label={t("fields.name")} htmlFor="fullName">
        <Input id="fullName" name="fullName" defaultValue={customer.full_name} required maxLength={120} disabled={!editable} />
      </FieldWrap>
      <FieldWrap label={t("fields.phone")} htmlFor="phone">
        <Input id="phone" name="phone" type="tel" defaultValue={customer.phone ?? ""} maxLength={40} disabled={!editable} />
      </FieldWrap>
      <FieldWrap label={t("fields.email")} htmlFor="email">
        <Input id="email" name="email" type="email" defaultValue={customer.email ?? ""} maxLength={200} disabled={!editable} />
      </FieldWrap>
      <FieldWrap label={t("fields.wechat")} htmlFor="wechat">
        <Input id="wechat" name="wechat" defaultValue={customer.wechat ?? ""} maxLength={60} disabled={!editable} />
      </FieldWrap>
      <FieldWrap label={t("fields.language")} htmlFor="language">
        <Select id="language" name="language" defaultValue={customer.preferred_language === "zh" ? "zh" : "en"} disabled={!editable}>
          <option value="zh">中文</option>
          <option value="en">English</option>
        </Select>
      </FieldWrap>
      <FieldWrap label={t("fields.dob")} htmlFor="dateOfBirth">
        <Input id="dateOfBirth" name="dateOfBirth" type="date" defaultValue={customer.date_of_birth ?? ""} disabled={!editable} />
      </FieldWrap>
      <FieldWrap label={t("fields.address")} htmlFor="address" className="sm:col-span-2">
        <Input id="address" name="address" defaultValue={customer.address ?? ""} maxLength={200} disabled={!editable} />
      </FieldWrap>
      <FieldWrap label={t("fields.licenseState")} htmlFor="licenseState">
        <Input id="licenseState" name="licenseState" defaultValue={customer.license_state ?? ""} maxLength={60} disabled={!editable} />
      </FieldWrap>
      <FieldWrap label={t("fields.licenseLast4")} htmlFor="licenseLast4">
        <Input id="licenseLast4" name="licenseLast4" defaultValue={customer.license_last4 ?? ""} maxLength={4} pattern="[A-Za-z0-9]{0,4}" disabled={!editable} />
      </FieldWrap>
      <FieldWrap label={t("fields.licenseExpires")} htmlFor="licenseExpires">
        <Input id="licenseExpires" name="licenseExpires" type="date" defaultValue={customer.license_expires_on ?? ""} disabled={!editable} />
      </FieldWrap>
      <FieldWrap label={t("fields.notes")} htmlFor="internalNotes" hint={t("fields.notesHint")} className="sm:col-span-2">
        <Textarea id="internalNotes" name="internalNotes" defaultValue={customer.internal_notes ?? ""} maxLength={4000} disabled={!editable} />
      </FieldWrap>
      <div className="rounded-xl border border-status-danger/25 bg-status-danger/[0.04] p-4 sm:col-span-2">
        <label className="flex items-center gap-2.5 text-[13px] font-medium text-ink">
          <input type="checkbox" name="dnrFlag" defaultChecked={customer.dnr_flag} disabled={!editable} className="size-4 accent-[#c4463a]" />
          {t("fields.dnr")}
        </label>
        <Input name="dnrReason" defaultValue={customer.dnr_reason ?? ""} maxLength={500} disabled={!editable} placeholder={t("fields.dnrReason")} className="mt-3" aria-label={t("fields.dnrReason")} />
      </div>
      {editable && (
        <div className="flex items-center gap-3 sm:col-span-2">
          <Button type="submit" disabled={pending}>
            {common("save")}
          </Button>
          {state.ok && <span className="text-[13px] text-status-available">{common("saved")}</span>}
          {state.error && (
            <span className="text-[13px] text-status-danger" role="alert">
              {t(`errors.${state.error}`)}
            </span>
          )}
        </div>
      )}
    </form>
  );
}
