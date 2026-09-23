"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { FieldWrap, Input, Select, Textarea } from "@/components/ui/Field";
import { assignVehicle, changeReservationStatus, saveReservationNotes, type ReservationActionState } from "./actions";
import { revertReservationStatus, setReadiness } from "./adjust-actions";
import { setDeliveryFee } from "./pricing-actions";
import { transitions, type ReservationStatus } from "./types";
import { formatMoney } from "@/lib/utils/format";

function ErrorText({ code }: { code?: string }) {
  const t = useTranslations("reservations");
  if (!code) return null;
  return (
    <p className="text-[13px] text-status-danger" role="alert">
      {t.has(`errors.${code}`) ? t(`errors.${code}`) : code}
    </p>
  );
}

type StatusProps = {
  reservationId: string;
  status: ReservationStatus;
  canEdit: boolean;
  canCancel: boolean;
  undo: { from: ReservationStatus } | null;
  fees: { cancel: number; noShow: number };
};

export function StatusActions({ reservationId, status, canEdit, canCancel, undo, fees }: StatusProps) {
  const t = useTranslations("reservations");
  const [state, action, pending] = useActionState<ReservationActionState, FormData>(changeReservationStatus, {});
  const [undoState, undoAction, undoPending] = useActionState<ReservationActionState, FormData>(revertReservationStatus, {});
  const next = transitions[status].filter((item) => item !== "ACTIVE" && item !== "COMPLETED").filter((item) => (item === "CANCELLED" || item === "NO_SHOW" ? canCancel : canEdit));
  const destructive = next.some((item) => item === "CANCELLED" || item === "NO_SHOW");

  return (
    <div className="flex flex-col gap-4">
      {undo && canEdit && (
        <form action={undoAction} className="flex flex-col gap-1.5 rounded-xl border border-dashed border-ink/15 bg-pearl/60 px-3.5 py-3">
          <input type="hidden" name="reservationId" value={reservationId} />
          <div>
            <Button type="submit" size="sm" variant="secondary" disabled={undoPending}>
              {t("detail.undo")}
            </Button>
          </div>
          <ErrorText code={undoState.error} />
        </form>
      )}
      {next.length === 0 ? (
        <p className="text-[13px] text-muted">{t("detail.noActions")}</p>
      ) : (
        <form
          action={action}
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
            const target = submitter?.value;
            if (target === "CANCELLED" && !window.confirm(fees.cancel > 0 ? t("detail.confirmCancelFee", { amount: formatMoney(fees.cancel) }) : t("detail.confirmCancel"))) event.preventDefault();
            if (target === "NO_SHOW" && !window.confirm(t("detail.confirmNoShow", { amount: formatMoney(fees.noShow) }))) event.preventDefault();
          }}
        >
          <input type="hidden" name="reservationId" value={reservationId} />
          {destructive && (
            <FieldWrap label={t("detail.reason")} htmlFor="reason">
              <Input id="reason" name="reason" maxLength={500} />
            </FieldWrap>
          )}
          <div className="flex flex-wrap gap-2">
            {next.map((item) => (
              <Button key={item} type="submit" name="status" value={item} size="sm" disabled={pending} variant={item === "CANCELLED" || item === "NO_SHOW" ? "danger" : "primary"}>
                {t(`action.${item}`)}
              </Button>
            ))}
          </div>
          {state.collection && (
            <p className={state.collection.error ? "text-[13px] text-status-danger" : "text-[13px] text-charcoal"}>
              {state.collection.error
                ? t("detail.collectFailed", { amount: formatMoney(state.collection.outstandingCents), error: t.has(`errors.${state.collection.error}`) ? t(`errors.${state.collection.error}`) : state.collection.error })
                : state.collection.chargedCents > 0
                  ? t("detail.collected", { amount: formatMoney(state.collection.chargedCents) })
                  : t("detail.nothingDue")}
            </p>
          )}
          {state.settlement && (
            <p className={state.settlement.error ? "text-[13px] text-status-danger" : "text-[13px] text-charcoal"}>
              {t("detail.settlement", { fee: formatMoney(state.settlement.feeCents), refund: formatMoney(state.settlement.refundedCents), charge: formatMoney(state.settlement.chargedCents) })}
              {state.settlement.uncollectedCents > 0 ? ` · ${t("detail.uncollected", { amount: formatMoney(state.settlement.uncollectedCents) })}` : ""}
              {state.settlement.error ? ` · ${state.settlement.error}` : ""}
            </p>
          )}
          <ErrorText code={state.error} />
        </form>
      )}
    </div>
  );
}

export function AssignVehicleForm({
  reservationId,
  currentId,
  options,
}: {
  reservationId: string;
  currentId: string | null;
  options: Array<{ id: string; fleetNumber: string; sameClass: boolean }>;
}) {
  const t = useTranslations("reservations");
  const common = useTranslations("common");
  const [state, action, pending] = useActionState<ReservationActionState, FormData>(assignVehicle, {});

  return (
    <form action={action} className="flex flex-col gap-2.5">
      <input type="hidden" name="reservationId" value={reservationId} />
      <div className="flex gap-2">
        <div className="min-w-0 flex-1">
          <Select name="vehicleId" defaultValue={currentId ?? ""} aria-label={t("detail.vehicle")}>
            {options.map((item) => (
              <option key={item.id} value={item.id}>
                {item.fleetNumber}
                {item.sameClass ? "" : ` · ${t("detail.otherClass")}`}
              </option>
            ))}
          </Select>
        </div>
        <Button type="submit" size="sm" variant="secondary" disabled={pending} className="h-11 shrink-0">
          {t("detail.assign")}
        </Button>
      </div>
      {state.ok && <p className="text-xs text-status-available">{common("saved")}</p>}
      <ErrorText code={state.error} />
    </form>
  );
}

export function NotesForm({ reservationId, notes, editable }: { reservationId: string; notes: string | null; editable: boolean }) {
  const t = useTranslations("reservations");
  const common = useTranslations("common");
  const [state, action, pending] = useActionState<ReservationActionState, FormData>(saveReservationNotes, {});

  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="reservationId" value={reservationId} />
      <Textarea name="internalNotes" defaultValue={notes ?? ""} maxLength={4000} disabled={!editable} aria-label={t("detail.internalNotes")} />
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

const readinessTone = (value: string): BadgeTone =>
  ["PAID", "VERIFIED", "SIGNED", "AUTHORIZED", "RELEASED"].includes(value) ? "success" : ["REJECTED", "FAILED"].includes(value) ? "danger" : "neutral";

type ReadinessProps = {
  reservationId: string;
  agreementHref?: string;
  payment: string;
  verification: string;
  agreement: string;
  hold: string;
  editable: boolean;
};

export function ReadinessControls({ reservationId, agreementHref, payment, verification, agreement, hold, editable }: ReadinessProps) {
  const t = useTranslations("reservations");
  const [state, action, pending] = useActionState<ReservationActionState, FormData>(setReadiness, {});

  const manual = (field: "verification" | "agreement", current: string, done: "VERIFIED" | "SIGNED") => (
    <form action={action} className="flex items-center gap-2">
      <input type="hidden" name="reservationId" value={reservationId} />
      <input type="hidden" name="field" value={field} />
      <Badge tone={readinessTone(current)}>{t(`state.${current}`)}</Badge>
      {editable && (
        <button
          type="submit"
          name="value"
          value={current === done ? "PENDING" : done}
          disabled={pending}
          className="rounded-pill px-2 py-0.5 text-[11px] text-charcoal underline decoration-gold/50 underline-offset-2 hover:decoration-gold disabled:opacity-50"
        >
          {current === done ? t("detail.unmark") : t(field === "verification" ? "detail.markVerified" : "detail.markSigned")}
        </button>
      )}
    </form>
  );

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-center justify-between text-[13px]">
        <span className="text-charcoal">{t("detail.payment")}</span>
        <Badge tone={readinessTone(payment)}>{t(`state.${payment}`)}</Badge>
      </div>
      <div className="flex items-center justify-between text-[13px]">
        <span className="text-charcoal">{t("detail.verification")}</span>
        {manual("verification", verification, "VERIFIED")}
      </div>
      <div className="flex items-center justify-between text-[13px]">
        <span className="text-charcoal">
          {t("detail.agreement")}
          {agreementHref && (
            <a href={agreementHref} className="ml-2 text-[11px] text-charcoal underline decoration-gold/50 underline-offset-2 hover:decoration-gold">
              {t("detail.viewAgreement")}
            </a>
          )}
        </span>
        {manual("agreement", agreement, "SIGNED")}
      </div>
      <div className="flex items-center justify-between text-[13px]">
        <span className="text-charcoal">{t("detail.hold")}</span>
        <Badge tone={readinessTone(hold)}>{t(`state.${hold}`)}</Badge>
      </div>
      <ErrorText code={state.error} />
    </div>
  );
}

export function DeliveryFeeForm({ reservationId, currentCents, editable }: { reservationId: string; currentCents: number; editable: boolean }) {
  const t = useTranslations("reservations");
  const common = useTranslations("common");
  const [state, action, pending] = useActionState<ReservationActionState, FormData>(setDeliveryFee, {});

  return (
    <form action={action} className="mt-3 flex flex-wrap items-center gap-2 border-t border-ink/[0.08] pt-3">
      <input type="hidden" name="reservationId" value={reservationId} />
      <span className="text-[13px] text-charcoal">{t("detail.deliveryFee")}</span>
      <div className="w-28">
        <Input name="amount" inputMode="decimal" defaultValue={(currentCents / 100).toFixed(currentCents % 100 === 0 ? 0 : 2)} disabled={!editable} required className="h-9" aria-label={t("detail.deliveryFee")} />
      </div>
      {editable && (
        <Button type="submit" size="sm" variant="secondary" disabled={pending}>
          {common("save")}
        </Button>
      )}
      {state.ok && <span className="text-xs text-status-available">{common("saved")}</span>}
      <ErrorText code={state.error} />
    </form>
  );
}
