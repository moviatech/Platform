"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Input, Select } from "@/components/ui/Field";
import { cn } from "@/lib/utils/cn";
import { formatMoney } from "@/lib/utils/format";
import { paymentAction, type PaymentActionState } from "./actions";

export type PaymentRow = {
  id: string;
  kind: "RENTAL" | "SECURITY_HOLD" | "ADDITIONAL" | "CANCELLATION_FEE";
  status: string;
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
  canCapture: boolean;
  canRefund: boolean;
  stripeReady: boolean;
  holdCents: number;
};

const tone: Record<string, BadgeTone> = {
  SUCCEEDED: "success",
  AUTHORIZED: "info",
  PENDING: "warning",
  REQUIRES_ACTION: "warning",
  FAILED: "danger",
  CANCELLED: "neutral",
  REFUNDED: "neutral",
  PARTIALLY_REFUNDED: "gold",
};

export function PaymentsPanel({ reservationId, payments, hasSavedCard, closed, canCapture, canRefund, stripeReady, holdCents }: Props) {
  const t = useTranslations("payments");
  const [state, action, pending] = useActionState<PaymentActionState, FormData>(paymentAction, {});
  const activeHold = payments.find((item) => item.kind === "SECURITY_HOLD" && item.status === "AUTHORIZED");
  const visible = payments.filter((item) => item.amount_cents > 0 || item.checkout_url);

  return (
    <div className="flex flex-col gap-4">
      {!stripeReady && <p className="rounded-xl bg-status-limited/10 px-3.5 py-2.5 text-[13px] text-charcoal">{t("notConfigured")}</p>}

      {visible.length === 0 ? (
        <p className="text-[13px] text-muted">{t("empty")}</p>
      ) : (
        <ul className="flex flex-col gap-2.5">
          {visible.map((item) => {
            const refundable = item.amount_captured_cents - item.amount_refunded_cents;
            const inactive = ["FAILED", "CANCELLED", "REFUNDED"].includes(item.status);
            return (
              <li key={item.id} className={cn("rounded-xl border border-ink/[0.07] px-3.5 py-3 text-[13px]", inactive && "opacity-60")}>
                <div className="flex items-center justify-between gap-3">
                  <span className="font-medium">{t(`kind.${item.kind}`)}</span>
                  <Badge tone={tone[item.status] ?? "neutral"}>{t(`status.${item.status}`)}</Badge>
                </div>
                <p className="mt-1 text-charcoal">
                  {formatMoney(item.kind === "SECURITY_HOLD" && item.status === "AUTHORIZED" ? item.amount_cents : item.amount_captured_cents || item.amount_cents)}
                  {item.amount_refunded_cents > 0 ? ` · ${t("refunded")} ${formatMoney(item.amount_refunded_cents)}` : ""}
                  {item.description ? <span className="text-muted"> · {item.description}</span> : null}
                </p>
                {item.failure_message && <p className="mt-1 text-xs text-status-danger">{item.failure_message}</p>}
                {item.checkout_url && item.status === "PENDING" && (
                  <input readOnly value={item.checkout_url} onFocus={(event) => event.currentTarget.select()} aria-label={t("payLink")} className="mt-2 h-9 w-full rounded-lg border border-ink/10 bg-pearl px-2.5 font-mono text-[11px]" />
                )}
                {canRefund && stripeReady && refundable > 0 && ["SUCCEEDED", "PARTIALLY_REFUNDED"].includes(item.status) && (
                  <form action={action} className="mt-2.5 flex gap-2">
                    <input type="hidden" name="intent" value="refund" />
                    <input type="hidden" name="reservationId" value={reservationId} />
                    <input type="hidden" name="paymentId" value={item.id} />
                    <Input name="amount" inputMode="decimal" required defaultValue={(refundable / 100).toFixed(2)} aria-label={t("amount")} className="h-9 w-24" />
                    <Input name="note" placeholder={t("reason")} maxLength={300} className="h-9" />
                    <Button type="submit" size="sm" variant="danger" disabled={pending} className="shrink-0">
                      {t("refund")}
                    </Button>
                  </form>
                )}
                {canCapture && stripeReady && item.id === activeHold?.id && (
                  <div className="mt-2.5 flex flex-col gap-2">
                    <form action={action} className="flex gap-2">
                      <input type="hidden" name="intent" value="capture" />
                      <input type="hidden" name="reservationId" value={reservationId} />
                      <input type="hidden" name="paymentId" value={item.id} />
                      <Input name="amount" inputMode="decimal" required placeholder={t("amount")} className="h-9 w-24" />
                      <Input name="note" required minLength={3} placeholder={t("captureReason")} maxLength={300} className="h-9" />
                      <Button type="submit" size="sm" variant="danger" disabled={pending} className="shrink-0">
                        {t("capture")}
                      </Button>
                    </form>
                    <form action={action}>
                      <input type="hidden" name="intent" value="release" />
                      <input type="hidden" name="reservationId" value={reservationId} />
                      <input type="hidden" name="paymentId" value={item.id} />
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
        <div className="flex flex-col gap-3 border-t border-ink/[0.07] pt-4">
          <form action={action} className="flex flex-wrap items-center gap-2">
            <input type="hidden" name="reservationId" value={reservationId} />
            <Button type="submit" name="intent" value="checkout" size="sm" disabled={pending}>
              {t("createLink")}
            </Button>
            {hasSavedCard && !activeHold && (
              <Button type="submit" name="intent" value="hold" size="sm" variant="secondary" disabled={pending}>
                {t("placeHold", { amount: formatMoney(holdCents) })}
              </Button>
            )}
          </form>
          {hasSavedCard ? (
            <form action={action} className="grid grid-cols-[6rem_minmax(0,1fr)] gap-2">
              <input type="hidden" name="intent" value="charge" />
              <input type="hidden" name="reservationId" value={reservationId} />
              <Input name="amount" inputMode="decimal" required placeholder={t("amount")} className="h-9" />
              <Select name="kind" defaultValue="ADDITIONAL" className="h-9" aria-label={t("chargeKind")}>
                <option value="ADDITIONAL">{t("kind.ADDITIONAL")}</option>
                <option value="RENTAL">{t("kind.RENTAL")}</option>
                <option value="CANCELLATION_FEE">{t("kind.CANCELLATION_FEE")}</option>
              </Select>
              <Input name="note" required minLength={3} maxLength={300} placeholder={t("chargeReason")} className="col-span-2 h-9" />
              <Button type="submit" size="sm" variant="secondary" disabled={pending} className="col-span-2 justify-self-start">
                {t("chargeCard")}
              </Button>
            </form>
          ) : (
            <p className="text-xs text-muted">{t("noCard")}</p>
          )}
        </div>
      )}

      {state.url && (
        <div className="rounded-xl bg-status-available/10 px-3.5 py-3 text-[13px]">
          <p className="font-medium text-ink">{t("linkReady")}</p>
          <input readOnly value={state.url} onFocus={(event) => event.currentTarget.select()} aria-label={t("payLink")} className="mt-2 h-9 w-full rounded-lg border border-ink/10 bg-white px-2.5 font-mono text-[11px]" />
        </div>
      )}
      {state.ok && !state.url && <p className="text-xs text-status-available">{t("done")}</p>}
      {state.error && (
        <p className="rounded-xl bg-status-danger/8 px-3.5 py-2.5 text-[13px] text-status-danger" role="alert">
          {t.has(`errors.${state.error}`) ? t(`errors.${state.error}`) : `${t("errors.generic")} (${state.error})`}
        </p>
      )}
    </div>
  );
}
