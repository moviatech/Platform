"use client";

import { useActionState, useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/Button";
import { FieldWrap, Input, Select, Textarea } from "@/components/ui/Field";
import { PhoneInput } from "@/components/ui/FormattedInput";
import { createInvestor, reviewInvestor, sendInvestorReset, setInvestorStatus, updateInvestorProfile, type InvestorOpsState } from "./ops-actions";

function Feedback({ state }: { state: InvestorOpsState }) {
  const t = useTranslations("investors");
  if (state.error) return <span className="text-[13px] text-status-danger">{t(`errors.${state.error}`)}</span>;
  if (state.ok) return <span className="text-[13px] text-status-available">✓</span>;
  return null;
}

function CompensationFields({ compensation: initial, share, rate, rateMonth, payoutDays }: { compensation: string; share: string; rate: string; rateMonth?: string; payoutDays: string }) {
  const t = useTranslations("investors");
  const [compensation, setCompensation] = useState(initial);
  return (
    <>
      <FieldWrap label={t("fields.compensation")} htmlFor="compensation">
        <Select id="compensation" name="compensation" value={compensation} onChange={(event) => setCompensation(event.target.value)}>
          <option value="REVENUE_SHARE">{t("compensation.REVENUE_SHARE")}</option>
          <option value="PER_MILE">{t("compensation.PER_MILE")}</option>
        </Select>
      </FieldWrap>
      {compensation === "PER_MILE" ? (
        <>
          <FieldWrap label={t("mileage.rate")} htmlFor="mileageRate">
            <Input id="mileageRate" name="mileageRate" inputMode="decimal" maxLength={8} defaultValue={rate} placeholder="0.50" />
          </FieldWrap>
          {rateMonth !== undefined && (
            <FieldWrap label={t("mileage.rateEffective")} htmlFor="rateMonth">
              <Input id="rateMonth" name="rateMonth" type="month" defaultValue={rateMonth} />
            </FieldWrap>
          )}
          <FieldWrap label={t("mileage.payoutDays")} htmlFor="payoutDays">
            <Input id="payoutDays" name="payoutDays" inputMode="numeric" maxLength={2} defaultValue={payoutDays} placeholder="7" />
          </FieldWrap>
        </>
      ) : (
        <FieldWrap label={t("fields.defaultShare")} htmlFor="defaultShare">
          <Input id="defaultShare" name="defaultShare" inputMode="decimal" maxLength={6} defaultValue={share} placeholder="60" />
        </FieldWrap>
      )}
    </>
  );
}

export function NewInvestorForm() {
  const t = useTranslations("investors");
  const [state, action, pending] = useActionState<InvestorOpsState, FormData>(createInvestor, {});
  return (
    <form action={action} className="grid gap-4 sm:grid-cols-2">
      <FieldWrap label={t("fields.legalName")} htmlFor="legalName">
        <Input id="legalName" name="legalName" required minLength={2} maxLength={120} />
      </FieldWrap>
      <FieldWrap label={t("fields.email")} htmlFor="email">
        <Input id="email" name="email" type="email" required maxLength={200} />
      </FieldWrap>
      <FieldWrap label={t("fields.phone")} htmlFor="phone">
        <PhoneInput id="phone" name="phone" required maxLength={40} placeholder="+1 (___) ___-____" />
      </FieldWrap>
      <FieldWrap label={t("fields.language")} htmlFor="language">
        <Select id="language" name="language" defaultValue="zh">
          <option value="zh">中文</option>
          <option value="en">English</option>
        </Select>
      </FieldWrap>
      <CompensationFields compensation="REVENUE_SHARE" share="" rate="" payoutDays="" />
      <FieldWrap label={t("fields.notes")} htmlFor="notes" className="sm:col-span-2">
        <Textarea id="notes" name="notes" maxLength={2000} />
      </FieldWrap>
      <div className="flex items-center gap-3 sm:col-span-2">
        <Button type="submit" disabled={pending}>
          {t("create")}
        </Button>
        <Feedback state={state} />
      </div>
    </form>
  );
}

export function ReviewForm({ id }: { id: string }) {
  const t = useTranslations("investors");
  const [state, action, pending] = useActionState<InvestorOpsState, FormData>(reviewInvestor, {});
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="id" value={id} />
      <FieldWrap label={t("fields.reviewNote")} htmlFor="reviewNote">
        <Textarea id="reviewNote" name="note" maxLength={1000} className="min-h-20" />
      </FieldWrap>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" name="decision" value="approve" size="sm" variant="gold" disabled={pending}>
          {t("approve")}
        </Button>
        <Button type="submit" name="decision" value="reject" size="sm" variant="danger" disabled={pending} onClick={(event) => !confirm(t("confirmReject")) && event.preventDefault()}>
          {t("reject")}
        </Button>
        <Feedback state={state} />
      </div>
    </form>
  );
}

export function StatusForm({ id, status }: { id: string; status: string }) {
  const t = useTranslations("investors");
  const [state, action, pending] = useActionState<InvestorOpsState, FormData>(setInvestorStatus, {});
  const targets = status === "ACTIVE" ? ["SUSPENDED", "CLOSED"] : status === "SUSPENDED" ? ["ACTIVE", "CLOSED"] : status === "REJECTED" ? ["ACTIVE"] : [];
  if (targets.length === 0) return null;
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="id" value={id} />
      <FieldWrap label={t("fields.statusNote")} htmlFor="statusNote">
        <Input id="statusNote" name="note" maxLength={1000} />
      </FieldWrap>
      <div className="flex flex-wrap items-center gap-2">
        {targets.map((target) => (
          <Button key={target} type="submit" name="status" value={target} size="sm" variant={target === "ACTIVE" ? "gold" : target === "CLOSED" ? "danger" : "secondary"} disabled={pending} onClick={(event) => !confirm(t(`confirm.${target}`)) && event.preventDefault()}>
            {t(`actions.${target}`)}
          </Button>
        ))}
        <Feedback state={state} />
      </div>
    </form>
  );
}

export function ProfileForm({ investor, rateCents, month }: { investor: { house: boolean; id: string; legal_name: string; email: string; phone: string; preferred_language: string; notes: string | null; default_share_bps: number | null; compensation: string; mileage_payout_days: number | null }; rateCents: number; month: string }) {
  const t = useTranslations("investors");
  const [state, action, pending] = useActionState<InvestorOpsState, FormData>(updateInvestorProfile, {});
  return (
    <form action={action} className="grid gap-4 sm:grid-cols-2">
      <input type="hidden" name="id" value={investor.id} />
      <FieldWrap label={t("fields.legalName")} htmlFor="legalName">
        <Input id="legalName" name="legalName" defaultValue={investor.legal_name} required minLength={2} maxLength={120} />
      </FieldWrap>
      <FieldWrap label={t("fields.email")} htmlFor="email">
        <Input id="email" value={investor.email} readOnly className="bg-pearl/60" />
      </FieldWrap>
      <FieldWrap label={t("fields.phone")} htmlFor="phone">
        <PhoneInput id="phone" name="phone" defaultValue={investor.phone} required maxLength={40} />
      </FieldWrap>
      <FieldWrap label={t("fields.language")} htmlFor="language">
        <Select id="language" name="language" defaultValue={investor.preferred_language === "en" ? "en" : "zh"}>
          <option value="zh">中文</option>
          <option value="en">English</option>
        </Select>
      </FieldWrap>
      <CompensationFields compensation={investor.compensation} share={investor.default_share_bps === null ? "" : String(investor.default_share_bps / 100)} rate={(rateCents / 100).toFixed(2)} rateMonth={month} payoutDays={investor.mileage_payout_days === null ? "" : String(investor.mileage_payout_days)} />
      <FieldWrap label={t("fields.notes")} htmlFor="notes" className="sm:col-span-2">
        <Textarea id="notes" name="notes" defaultValue={investor.notes ?? ""} maxLength={4000} />
      </FieldWrap>
      <label className="flex items-center gap-2 text-[13px] sm:col-span-2">
        <input type="checkbox" name="house" defaultChecked={investor.house} className="h-4 w-4 accent-gold" />
        {t("fields.house")}
      </label>
      <div className="flex items-center gap-3 sm:col-span-2">
        <Button type="submit" size="sm" disabled={pending}>
          {t("save")}
        </Button>
        <Feedback state={state} />
      </div>
    </form>
  );
}

export function ResetEmailButton({ id }: { id: string }) {
  const t = useTranslations("investors");
  const [state, action, pending] = useActionState<InvestorOpsState, FormData>(sendInvestorReset, {});
  return (
    <form action={action} className="flex items-center gap-2">
      <input type="hidden" name="id" value={id} />
      <Button type="submit" size="sm" variant="secondary" disabled={pending}>
        {t("sendReset")}
      </Button>
      {state.ok ? <span className="text-[13px] text-status-available">{t("resetSent")}</span> : <Feedback state={state} />}
    </form>
  );
}
