"use client";

import { useActionState, useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/Button";
import { FieldWrap, Input, Select } from "@/components/ui/Field";
import { MoneyInput } from "@/components/ui/FormattedInput";
import { addResolution, approveResolution, lockMonth, reopenMonth, resolveException, setInclusion, voidResolution, type LedgerState } from "./actions";

const categories = ["INCOME_DAMAGE", "INCOME_FEES", "INCOME_OTHER", "ALLOWANCE", "BAD_DEBT", "REFUND_PAYABLE"] as const;

function Feedback({ state }: { state: LedgerState }) {
  const t = useTranslations("finance.ledger.errors");
  if (state.error) return <span className="text-[13px] text-status-danger">{t(state.error)}</span>;
  if (state.ok) return <span className="text-[13px] text-status-available">✓</span>;
  return null;
}

function useResettable(run: (previous: LedgerState, form: FormData) => Promise<LedgerState>) {
  const [version, setVersion] = useState(0);
  const [state, action, pending] = useActionState<LedgerState, FormData>(async (previous, form) => {
    const next = await run(previous, form);
    if (next.ok) setVersion((value) => value + 1);
    return next;
  }, {});
  return { version, state, action, pending };
}

export function ResolutionForm() {
  const t = useTranslations("finance.ledger.resolutions");
  const { version, state, action, pending } = useResettable(addResolution);
  return (
    <form key={version} action={action} className="grid gap-3 sm:grid-cols-5">
      <FieldWrap label={t("order")} htmlFor="resolution-order">
        <Input id="resolution-order" name="number" required placeholder="MV-" autoComplete="off" />
      </FieldWrap>
      <FieldWrap label={t("category")} htmlFor="resolution-category">
        <Select id="resolution-category" name="category" required defaultValue="">
          <option value="" disabled>
            —
          </option>
          {categories.map((category) => (
            <option key={category} value={category}>
              {t(`categories.${category}`)}
            </option>
          ))}
        </Select>
      </FieldWrap>
      <FieldWrap label={t("amount")} htmlFor="resolution-amount">
        <MoneyInput id="resolution-amount" name="amount" required placeholder="$" />
      </FieldWrap>
      <FieldWrap label={t("reason")} htmlFor="resolution-reason" className="sm:col-span-2">
        <Input id="resolution-reason" name="reason" required minLength={2} maxLength={1000} />
      </FieldWrap>
      <div className="flex items-center gap-3 sm:col-span-5">
        <Button type="submit" size="sm" disabled={pending}>
          {t("add")}
        </Button>
        <Feedback state={state} />
      </div>
    </form>
  );
}

export function ApproveButton({ id }: { id: string }) {
  const t = useTranslations("finance.ledger.resolutions");
  const [state, action, pending] = useActionState<LedgerState, FormData>(approveResolution, {});
  return (
    <form action={action} className="flex items-center gap-2">
      <input type="hidden" name="id" value={id} />
      <Button type="submit" size="sm" variant="secondary" disabled={pending}>
        {t("approve")}
      </Button>
      <Feedback state={state} />
    </form>
  );
}

export function VoidForm({ id }: { id: string }) {
  const t = useTranslations("finance.ledger.resolutions");
  const { version, state, action, pending } = useResettable(voidResolution);
  return (
    <form key={version} action={action} className="flex items-center gap-2">
      <input type="hidden" name="id" value={id} />
      <Input name="reason" required minLength={2} maxLength={500} placeholder={t("voidReason")} className="h-8 w-40 text-[12px]" />
      <Button type="submit" size="sm" variant="secondary" disabled={pending}>
        {t("void")}
      </Button>
      <Feedback state={state} />
    </form>
  );
}

export function InclusionForm() {
  const t = useTranslations("finance.ledger.inclusion");
  const { version, state, action, pending } = useResettable(setInclusion);
  return (
    <form key={version} action={action} className="grid gap-3 sm:grid-cols-5">
      <FieldWrap label={t("type")} htmlFor="inclusion-type">
        <Select id="inclusion-type" name="objectType" defaultValue="reservation">
          <option value="reservation">{t("reservation")}</option>
          <option value="investor">{t("investor")}</option>
        </Select>
      </FieldWrap>
      <FieldWrap label={t("number")} htmlFor="inclusion-number">
        <Input id="inclusion-number" name="number" required autoComplete="off" />
      </FieldWrap>
      <FieldWrap label={t("decision")} htmlFor="inclusion-included">
        <Select id="inclusion-included" name="included" defaultValue="false">
          <option value="true">{t("included")}</option>
          <option value="false">{t("excluded")}</option>
        </Select>
      </FieldWrap>
      <FieldWrap label={t("reason")} htmlFor="inclusion-reason" className="sm:col-span-2">
        <Input id="inclusion-reason" name="reason" required minLength={2} maxLength={500} />
      </FieldWrap>
      <div className="flex items-center gap-3 sm:col-span-5">
        <Button type="submit" size="sm" disabled={pending}>
          {t("save")}
        </Button>
        <Feedback state={state} />
      </div>
    </form>
  );
}

export function ResolveForm({ id }: { id: number }) {
  const t = useTranslations("finance.ledger.pending");
  const { version, state, action, pending } = useResettable(resolveException);
  return (
    <form key={version} action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="id" value={id} />
      <Input name="note" required minLength={2} maxLength={1000} placeholder={t("note")} className="h-8 w-56 text-[12px]" />
      <Button type="submit" size="sm" variant="secondary" disabled={pending}>
        {t("resolve")}
      </Button>
      <Feedback state={state} />
    </form>
  );
}

export function LockButton({ period }: { period: string }) {
  const t = useTranslations("finance.ledger.months");
  const [state, action, pending] = useActionState<LedgerState, FormData>(lockMonth, {});
  return (
    <form action={action} className="flex items-center gap-2">
      <input type="hidden" name="period" value={period} />
      <Button type="submit" size="sm" variant="secondary" disabled={pending}>
        {t("lock")}
      </Button>
      <Feedback state={state} />
    </form>
  );
}

export function ReopenForm({ period }: { period: string }) {
  const t = useTranslations("finance.ledger.months");
  const { version, state, action, pending } = useResettable(reopenMonth);
  return (
    <form key={version} action={action} className="flex items-center gap-2">
      <input type="hidden" name="period" value={period} />
      <Input name="reason" required minLength={2} maxLength={500} placeholder={t("reopenReason")} className="h-8 w-40 text-[12px]" />
      <Button type="submit" size="sm" variant="secondary" disabled={pending}>
        {t("reopen")}
      </Button>
      <Feedback state={state} />
    </form>
  );
}
