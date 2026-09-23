"use client";

import { useActionState, useState } from "react";
import { useTranslations } from "next-intl";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Input, Select } from "@/components/ui/Field";
import { cn } from "@/lib/utils/cn";
import { formatDateTime, formatMoney } from "@/lib/utils/format";
import { paymentAction, type PaymentActionState } from "./actions";

export type PaymentRow = {
  id: string;
  kind: "RENTAL" | "SECURITY_HOLD" | "ADDITIONAL" | "CANCELLATION_FEE";
  status: "PENDING" | "REQUIRES_ACTION" | "AUTHORIZED" | "SUCCEEDED" | "PARTIALLY_REFUNDED" | "REFUNDED" | "FAILED" | "CANCELLED";
  amount_cents: number;
  amount_captured_cents: number;
  amount_refunded_cents: number;
  description: string | null;
  checkout_url: string | null;
  failure_message: string | null;
  created_at: string;
};

type Props = {
  reservationId: string;
  payments: PaymentRow[];
  hasSavedCard: boolean;
  closed: boolean;
  open: boolean;
  canCapture: boolean;
  canRefund: boolean;
  stripeReady: boolean;
  holdCents: number;
  dueCents: number;
};

const tone: Record<PaymentRow["status"], BadgeTone> = { PENDING: "neutral", REQUIRES_ACTION: "warning", AUTHORIZED: "info", SUCCEEDED: "success", PARTIALLY_REFUNDED: "warning", REFUNDED: "neutral", FAILED: "danger", CANCELLED: "neutral" };

export function PaymentsPanel({ reservationId, payments, hasSavedCard, closed, open, canCapture, canRefund, stripeReady, holdCents, dueCents }: Props) {
  const t = useTranslations("payments");
  const [state, action, pending] = useActionState<PaymentActionState, FormData>(paymentAction, {});
  const [editing, setEditing] = useState<string | null>(null);
  const [extra, setExtra] = useState(false);
  const activeHold = payments.find((item) => item.kind === "SECURITY_HOLD" && item.status === "AUTHORIZED");
  const visible = payments.filter((item) => {
    if (item.status === "CANCELLED") return false;
    if (item.status === "PENDING" || item.status === "REQUIRES_ACTION") return dueCents > 0 && Boolean(item.checkout_url);
    return item.amount_cents > 0;
  });
  const hidden = (name: string, value: string) => <input type="hidden" name={name} value={value} />;
  const amountOf = (item: PaymentRow) => (item.kind === "SECURITY_HOLD" && item.status === "AUTHORIZED" ? item.amount_cents : item.amount_captured_cents || item.amount_cents);

  return (
    <div className="flex flex-col gap-4">
      {!stripeReady && <p className="rounded-xl bg-status-limited/10 px-3.5 py-2.5 text-[13px] text-charcoal">{t("notConfigured")}</p>}

      {visible.length === 0 ? (
        <p className="text-[13px] text-muted">{t("empty")}</p>
      ) : (
        <ul className="divide-y divide-ink/[0.06] text-sm">
          {visible.map((item) => {
            const refundable = item.amount_captured_cents - item.amount_refunded_cents;
            const canEditRefund = canRefund && stripeReady && refundable > 0 && ["SUCCEEDED", "PARTIALLY_REFUNDED"].includes(item.status);
            const isHold = canCapture && stripeReady && item.id === activeHold?.id;
            const openRow = editing === item.id;
            return (
              <li key={item.id} className={cn("py-2.5", ["FAILED", "REFUNDED"].includes(item.status) && "opacity-60")}>
                <div className="flex items-center gap-3">
                  <span className="min-w-0 flex-1">
                    <span className="font-medium">{t(`kind.${item.kind}`)}</span>
                    <span className="block text-[12px] text-muted">
                      {formatDateTime(item.created_at)}
                      {item.amount_refunded_cents > 0 ? ` · ${t("refunded")} ${formatMoney(item.amount_refunded_cents)}` : ""}
                      {item.failure_message ? ` · ${item.failure_message}` : ""}
                    </span>
                  </span>
                  <span className="tabular-nums">{formatMoney(amountOf(item))}</span>
                  <Badge tone={tone[item.status]}>{t(`status.${item.status}`)}</Badge>
                  {(canEditRefund || isHold) && (
                    <button type="button" onClick={() => setEditing(openRow ? null : item.id)} className="rounded-pill px-2.5 py-1 text-[12px] text-charcoal hairline hover:border-ink/25" aria-expanded={openRow}>
                      {openRow ? t("close") : t("edit")}
                    </button>
                  )}
                </div>
                {item.checkout_url && (item.status === "PENDING" || item.status === "REQUIRES_ACTION") && (
                  <input readOnly value={item.checkout_url} onFocus={(event) => event.currentTarget.select()} aria-label={t("payLink")} className="mt-2 h-9 w-full rounded-lg border border-ink/10 bg-pearl px-2.5 font-mono text-[11px]" />
                )}
                {openRow && canEditRefund && (
                  <form action={action} className="mt-2.5 flex flex-wrap gap-2">
                    {hidden("intent", "refund")}
                    {hidden("reservationId", reservationId)}
                    {hidden("paymentId", item.id)}
                    <Input name="amount" inputMode="decimal" required defaultValue={(refundable / 100).toFixed(2)} aria-label={t("amount")} className="h-9 w-28" />
                    <Input name="note" placeholder={t("reason")} maxLength={300} className="h-9 min-w-40 flex-1" />
                    <Button type="submit" size="sm" variant="danger" disabled={pending}>
                      {t("refund")}
                    </Button>
                  </form>
                )}
                {openRow && isHold && (
                  <div className="mt-2.5 flex flex-col gap-2">
                    <form action={action} className="flex flex-wrap gap-2">
                      {hidden("intent", "capture")}
                      {hidden("reservationId", reservationId)}
                      {hidden("paymentId", item.id)}
                      <Input name="amount" inputMode="decimal" required placeholder={t("amount")} className="h-9 w-28" />
                      <Input name="note" required minLength={3} placeholder={t("captureReason")} maxLength={300} className="h-9 min-w-40 flex-1" />
                      <Button type="submit" size="sm" variant="danger" disabled={pending}>
                        {t("capture")}
                      </Button>
                    </form>
                    <form action={action}>
                      {hidden("intent", "release")}
                      {hidden("reservationId", reservationId)}
                      {hidden("paymentId", item.id)}
                      <Button type="submit" size="sm" variant="secondary" disabled={pending}>
                        {t("release")}
                      </Button>
                    </form>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {canCapture && stripeReady && !closed && (
        <div className="flex flex-col gap-2.5 border-t border-ink/[0.07] pt-4">
          <div className="flex flex-wrap items-center gap-2">
            {dueCents > 0 && hasSavedCard && (
              <form action={action}>
                {hidden("intent", "charge")}
                {hidden("reservationId", reservationId)}
                {hidden("amount", (dueCents / 100).toFixed(2))}
                {hidden("kind", "RENTAL")}
                {hidden("note", "Balance")}
                <Button type="submit" size="sm" disabled={pending}>
                  {t("collectDue", { amount: formatMoney(dueCents) })}
                </Button>
              </form>
            )}
            {dueCents > 0 && !hasSavedCard && (
              <form action={action}>
                {hidden("reservationId", reservationId)}
                <Button type="submit" name="intent" value="checkout" size="sm" disabled={pending}>
                  {t("createLink")}
                </Button>
              </form>
            )}
            {hasSavedCard && !activeHold && open && (
              <form action={action}>
                {hidden("reservationId", reservationId)}
                <Button type="submit" name="intent" value="hold" size="sm" variant="secondary" disabled={pending}>
                  {t("placeHold", { amount: formatMoney(holdCents) })}
                </Button>
              </form>
            )}
            {hasSavedCard && (
              <button type="button" onClick={() => setExtra((value) => !value)} className="text-[12px] text-muted hover:text-ink">
                {extra ? t("close") : t("extraCharge")}
              </button>
            )}
          </div>
          {hasSavedCard && extra && (
            <form action={action} className="grid grid-cols-[7rem_minmax(0,1fr)] gap-2">
              {hidden("intent", "charge")}
              {hidden("reservationId", reservationId)}
              <Input name="amount" inputMode="decimal" required placeholder={t("amount")} className="h-9" />
              <Select name="kind" defaultValue="ADDITIONAL" className="h-9" aria-label={t("chargeKind")}>
                <option value="ADDITIONAL">{t("kind.ADDITIONAL")}</option>
                <option value="CANCELLATION_FEE">{t("kind.CANCELLATION_FEE")}</option>
              </Select>
              <Input name="note" required minLength={3} maxLength={300} placeholder={t("chargeReason")} className="col-span-2 h-9" />
              <Button type="submit" size="sm" variant="secondary" disabled={pending} className="col-span-2 justify-self-start">
                {t("chargeCard")}
              </Button>
            </form>
          )}
        </div>
      )}

      {state.url && <p className="text-xs text-status-available">{t("linkReady")}</p>}
      {state.ok && !state.url && <p className="text-xs text-status-available">{state.pending ? t("pendingApproval") : t("done")}</p>}
      {state.error && (
        <p className="rounded-xl bg-status-danger/8 px-3.5 py-2.5 text-[13px] text-status-danger" role="alert">
          {t.has(`errors.${state.error}`) ? t(`errors.${state.error}`) : `${t("errors.generic")} (${state.error})`}
        </p>
      )}
    </div>
  );
}
