"use client";

import { useActionState, useRef, useState, type ChangeEvent } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/Button";
import { FieldWrap, Input, Select } from "@/components/ui/Field";
import { MoneyInput } from "@/components/ui/FormattedInput";
import { maxReceiptBytes, receiptTypes } from "../report";
import { addBankBalance, attachTaxEvidence, createTaxEvidenceUpload, deleteBankBalance, saveVehicleCosts, type BoardState } from "./actions";

function Feedback({ state }: { state: BoardState }) {
  const t = useTranslations("finance.board.errors");
  if (state.error) return <span className="text-[13px] text-status-danger">{t(state.error)}</span>;
  if (state.ok) return <span className="text-[13px] text-status-available">✓</span>;
  return null;
}

function useResettable(run: (previous: BoardState, form: FormData) => Promise<BoardState>) {
  const [version, setVersion] = useState(0);
  const [state, action, pending] = useActionState<BoardState, FormData>(async (previous, form) => {
    const next = await run(previous, form);
    if (next.ok) setVersion((value) => value + 1);
    return next;
  }, {});
  return { version, state, action, pending };
}

const dollars = (cents: number | null) => (cents === null ? "" : String(cents / 100));

export type CostsDefaults = {
  vehicleId: string;
  inServiceOn: string | null;
  retiredOn: string | null;
  purchasePriceCents: number | null;
  depreciationMonths: number | null;
  residualCents: number | null;
  monthlyPaymentCents: number | null;
  purchaseTax: string | null;
  evidenceStored: boolean;
  evidenceNote: string | null;
  insuranceMonthlyCents: number | null;
  registrationYearlyCents: number | null;
};

export function VehicleCostsForm({ costs }: { costs: CostsDefaults }) {
  const t = useTranslations("finance.board.setup");
  const { version, state, action, pending } = useResettable(saveVehicleCosts);
  const [tax, setTax] = useState(costs.purchaseTax ?? "");
  const id = (name: string) => `${name}-${costs.vehicleId}`;
  return (
    <form key={version} action={action} className="grid gap-3 sm:grid-cols-4">
      <input type="hidden" name="vehicleId" value={costs.vehicleId} />
      <FieldWrap label={t("inServiceOn")} htmlFor={id("in")}>
        <Input id={id("in")} type="date" name="inServiceOn" defaultValue={costs.inServiceOn ?? ""} />
      </FieldWrap>
      <FieldWrap label={t("retiredOn")} htmlFor={id("out")}>
        <Input id={id("out")} type="date" name="retiredOn" defaultValue={costs.retiredOn ?? ""} />
      </FieldWrap>
      <FieldWrap label={t("purchasePrice")} htmlFor={id("price")}>
        <MoneyInput id={id("price")} name="purchasePrice" defaultValue={dollars(costs.purchasePriceCents)} placeholder="$" />
      </FieldWrap>
      <FieldWrap label={t("depreciationMonths")} htmlFor={id("months")}>
        <Input id={id("months")} name="depreciationMonths" inputMode="numeric" defaultValue={costs.depreciationMonths ?? 60} />
      </FieldWrap>
      <FieldWrap label={t("residual")} htmlFor={id("residual")}>
        <MoneyInput id={id("residual")} name="residual" defaultValue={dollars(costs.residualCents)} placeholder="$" />
      </FieldWrap>
      <FieldWrap label={t("monthlyPayment")} htmlFor={id("payment")}>
        <MoneyInput id={id("payment")} name="monthlyPayment" defaultValue={dollars(costs.monthlyPaymentCents)} placeholder="$" />
      </FieldWrap>
      <FieldWrap label={t("insuranceMonthly")} htmlFor={id("insurance")}>
        <MoneyInput id={id("insurance")} name="insuranceMonthly" defaultValue={dollars(costs.insuranceMonthlyCents)} placeholder="$" />
      </FieldWrap>
      <FieldWrap label={t("registrationYearly")} htmlFor={id("registration")}>
        <MoneyInput id={id("registration")} name="registrationYearly" defaultValue={dollars(costs.registrationYearlyCents)} placeholder="$" />
      </FieldWrap>
      <FieldWrap label={t("purchaseTax")} htmlFor={id("tax")}>
        <Select id={id("tax")} name="purchaseTax" defaultValue={tax} onChange={(event) => setTax(event.target.value)}>
          <option value="">—</option>
          {(["PAID", "RESALE", "UNKNOWN"] as const).map((value) => (
            <option key={value} value={value}>
              {t(`taxOptions.${value}`)}
            </option>
          ))}
        </Select>
      </FieldWrap>
      <FieldWrap label={t("taxEvidencePath")} htmlFor={id("evidence")}>
        <TaxEvidenceUpload id={id("evidence")} vehicleId={costs.vehicleId} stored={costs.evidenceStored} note={costs.evidenceNote} />
      </FieldWrap>
      <div className="flex items-end gap-3">
        <Button type="submit" size="sm" disabled={pending}>
          {t("save")}
        </Button>
        <Feedback state={state} />
      </div>
    </form>
  );
}

function TaxEvidenceUpload({ id, vehicleId, stored, note }: { id: string; vehicleId: string; stored: boolean; note: string | null }) {
  const t = useTranslations("finance.board.setup");
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [stage, setStage] = useState<"idle" | "busy" | "failed">("idle");

  const onChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!receiptTypes.test(file.type) || file.size <= 0 || file.size > maxReceiptBytes) {
      setStage("failed");
      return;
    }
    setStage("busy");
    const target = await createTaxEvidenceUpload(vehicleId, { type: file.type, size: file.size });
    if (!target) {
      setStage("failed");
      return;
    }
    const response = await fetch(target.url, { method: "PUT", headers: { "Content-Type": file.type }, body: file }).catch(() => null);
    if (!response?.ok) {
      setStage("failed");
      return;
    }
    const done = await attachTaxEvidence(vehicleId, target.path, file.type, file.size);
    setStage(done.ok ? "idle" : "failed");
    if (done.ok) router.refresh();
  };

  return (
    <div className="flex h-11 min-w-0 items-center gap-3 text-[13px]">
      {stored ? (
        <a href={`/finance/board/setup/evidence/${vehicleId}`} target="_blank" rel="noreferrer" className="text-gold hover:underline">
          {t("view")}
        </a>
      ) : note ? (
        <span className="min-w-0 truncate text-muted" title={note}>
          {note}
        </span>
      ) : null}
      <input ref={input} type="file" hidden accept="application/pdf,image/jpeg,image/png,image/webp,image/heic" onChange={onChange} />
      <button id={id} type="button" disabled={stage === "busy"} onClick={() => input.current?.click()} className={stage === "failed" ? "shrink-0 text-status-danger hover:underline" : "shrink-0 text-gold hover:underline"}>
        {stage === "busy" ? "…" : stage === "failed" ? t("uploadFailed") : stored ? t("replace") : t("upload")}
      </button>
    </div>
  );
}

export function BankBalanceForm({ accounts, today }: { accounts: string[]; today: string }) {
  const t = useTranslations("finance.board.setup");
  const { version, state, action, pending } = useResettable(addBankBalance);
  return (
    <form key={version} action={action} className="grid gap-3 sm:grid-cols-4">
      <FieldWrap label={t("accountName")} htmlFor="bank-account">
        <Input id="bank-account" name="accountName" required maxLength={80} list="bank-accounts" autoComplete="off" />
        <datalist id="bank-accounts">
          {accounts.map((name) => (
            <option key={name} value={name} />
          ))}
        </datalist>
      </FieldWrap>
      <FieldWrap label={t("asOf")} htmlFor="bank-date">
        <Input id="bank-date" type="date" name="asOf" required max={today} defaultValue={today} />
      </FieldWrap>
      <FieldWrap label={t("balance")} htmlFor="bank-balance">
        <Input id="bank-balance" name="balance" required inputMode="decimal" placeholder="$" autoComplete="off" />
      </FieldWrap>
      <div className="flex items-end gap-3">
        <Button type="submit" size="sm" disabled={pending}>
          {t("add")}
        </Button>
        <Feedback state={state} />
      </div>
    </form>
  );
}

export function DeleteBankBalance({ id }: { id: number }) {
  const t = useTranslations("finance.board.setup");
  const [state, action, pending] = useActionState<BoardState, FormData>(deleteBankBalance, {});
  return (
    <form action={action} className="flex items-center gap-2">
      <input type="hidden" name="id" value={id} />
      <Button type="submit" size="sm" variant="ghost" disabled={pending}>
        {t("delete")}
      </Button>
      <Feedback state={state} />
    </form>
  );
}
