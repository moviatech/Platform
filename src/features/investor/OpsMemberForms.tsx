"use client";

import { useActionState, useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/Button";
import { FieldWrap, Input, Select } from "@/components/ui/Field";
import { MoneyInput } from "@/components/ui/FormattedInput";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { addStake, attachMember, voidStake, type InvestorOpsState } from "./ops-actions";

export function AddStakeForm({ members, memberId, today }: { members?: Array<{ id: string; label: string }>; memberId?: string; today: string }) {
  const t = useTranslations("investors");
  const [version, setVersion] = useState(0);
  const [date, setDate] = useState(today);
  const [state, action, pending] = useActionState<InvestorOpsState, FormData>(async (previous, form) => {
    const next = await addStake(previous, form);
    if (next.ok) {
      setVersion((value) => value + 1);
      setDate(today);
    }
    return next;
  }, {});
  return (
    <form key={version} action={action} className="grid gap-3 sm:grid-cols-2">
      {memberId ? (
        <input type="hidden" name="memberId" value={memberId} />
      ) : (
        <FieldWrap label={t("company.member")} htmlFor="stakeMember" className="sm:col-span-2">
          <Select id="stakeMember" name="memberId" required defaultValue="">
            <option value="" disabled>
              —
            </option>
            {(members ?? []).map((member) => (
              <option key={member.id} value={member.id}>
                {member.label}
              </option>
            ))}
          </Select>
        </FieldWrap>
      )}
      <FieldWrap label={t("company.stakeAmount")} htmlFor="stakeAmount">
        <MoneyInput id="stakeAmount" name="amount" required placeholder="$" />
      </FieldWrap>
      <FieldWrap label={t("company.stakeDate")} htmlFor="stakeEffectiveOn">
        <Input id="stakeEffectiveOn" name="effectiveOn" type="date" required value={date} onChange={(event) => setDate(event.target.value)} />
      </FieldWrap>
      <FieldWrap label={t("payouts.note")} htmlFor="stakeNote" className="sm:col-span-2">
        <Input id="stakeNote" name="note" maxLength={500} />
      </FieldWrap>
      <div className="flex items-center gap-3 sm:col-span-2">
        <Button type="submit" size="sm" disabled={pending}>
          {t("company.addStake")}
        </Button>
        {state.error ? <span className="text-[13px] text-status-danger">{t(`errors.${state.error}`)}</span> : state.ok ? <span className="text-[13px] text-status-available">✓</span> : null}
      </div>
    </form>
  );
}

export function AttachMemberForm({ companyId, candidates, today }: { companyId: string; candidates: Array<{ id: string; label: string }>; today: string }) {
  const t = useTranslations("investors");
  const [date, setDate] = useState(today);
  const [state, action, pending] = useActionState<InvestorOpsState, FormData>(attachMember, {});
  return (
    <form action={action} className="grid gap-3 sm:grid-cols-2">
      <input type="hidden" name="companyId" value={companyId} />
      <FieldWrap label={t("company.member")} htmlFor="attachMember" className="sm:col-span-2">
        <Select id="attachMember" name="memberId" required defaultValue="">
          <option value="" disabled>
            —
          </option>
          {candidates.map((candidate) => (
            <option key={candidate.id} value={candidate.id}>
              {candidate.label}
            </option>
          ))}
        </Select>
      </FieldWrap>
      <FieldWrap label={t("company.stake")} htmlFor="attachStake">
        <MoneyInput id="attachStake" name="stakeAmount" placeholder="$" />
      </FieldWrap>
      <FieldWrap label={t("company.stakeDate")} htmlFor="attachDate">
        <Input id="attachDate" name="stakeDate" type="date" value={date} onChange={(event) => setDate(event.target.value)} />
      </FieldWrap>
      <div className="flex items-center gap-3 sm:col-span-2">
        <Button type="submit" size="sm" disabled={pending}>
          {t("company.attach")}
        </Button>
        {state.error ? <span className="text-[13px] text-status-danger">{t(`errors.${state.error}`)}</span> : state.ok ? <span className="text-[13px] text-status-available">✓</span> : null}
      </div>
    </form>
  );
}

export function VoidStakeButton({ id }: { id: string }) {
  const t = useTranslations("investors");
  const [state, action, pending] = useActionState<InvestorOpsState, FormData>(voidStake, {});
  if (state.ok) return <span className="text-[12px] text-muted">{t("company.voided")}</span>;
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="id" value={id} />
      <SubmitButton disabled={pending} className="text-[12px] text-muted hover:text-status-danger" onClick={(event) => !confirm(t("company.confirmVoid")) && event.preventDefault()}>
        {t("company.void")}
      </SubmitButton>
      {state.error && <span className="text-[12px] text-status-danger">{t(`errors.${state.error}`)}</span>}
    </form>
  );
}
