"use client";

import { useActionState, useState } from "react";
import { useTranslations } from "next-intl";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Input, Select } from "@/components/ui/Field";
import { cn } from "@/lib/utils/cn";
import { formatDateTime, formatMoney } from "@/lib/utils/format";
import { paymentAction, type PaymentActionState } from "./actions";
import { offlineMethods } from "./method";

export type PaymentRow = {
  id: string;
  kind: "RENTAL" | "SECURITY_HOLD" | "ADDITIONAL" | "CANCELLATION_FEE";
  status: "PENDING" | "REQUIRES_ACTION" | "AUTHORIZED" | "SUCCEEDED" | "PARTIALLY_REFUNDED" | "REFUNDED" | "FAILED" | "CANCELLED";
  amount_cents: number;
  amount_captured_cents: number;
  amount_refunded_cents: number;
  description: string | null;
  checkout_url: string | null;
  pay_url?: string | null;
  failure_message: string | null;
  offline_method?: string | null;
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
  extrasDueCents?: number;
  tollPending?: boolean;
  offlineDueCents?: number;
};

const tone: Record<PaymentRow["status"], BadgeTone> = { PENDING: "neutral", REQUIRES_ACTION: "warning", AUTHORIZED: "info", SUCCEEDED: "success", PARTIALLY_REFUNDED: "warning", REFUNDED: "neutral", FAILED: "danger", CANCELLED: "neutral" };

export function PaymentsPanel({ reservationId, payments, hasSavedCard, closed, open, canCapture, canRefund, stripeReady, holdCents, dueCents, extrasDueCents = 0, tollPending, offlineDueCents = 0 }: Props) {
  const t = useTranslations("payments");
  const [state, action, pending] = useActionState<PaymentActionState, FormData>(paymentAction, {});
  const [editing, setEditing] = useState<string | null>(null);
  const [panel, setPanel] = useState<"extra" | "link" | "offline" | null>(null);
  const [chargeKind, setChargeKind] = useState("ADDITIONAL");
  const rentDueCents = dueCents - extrasDueCents;
  const activeHold = payments.find((item) => item.kind === "SECURITY_HOLD" && item.status === "AUTHORIZED");
  const visible = payments.filter((item) => {
    if (item.status === "CANCELLED") return false;
    if (item.status === "PENDING" || item.status === "REQUIRES_ACTION") return Boolean(item.pay_url);
    return item.amount_cents > 0;
  });
  const hidden = (name: string, value: string) => <input type="hidden" name={name} value={value} />;
  const tab = (id: "extra" | "link" | "offline", label: string) => (
    <button type="button" onClick={() => setPanel(panel === id ? null : id)} aria-expanded={panel === id} className={cn("rounded-pill px-3 py-1.5 text-[12px]", panel === id ? "bg-ink text-white" : "text-charcoal hairline hover:border-ink/25")}>
      {label}
    </button>
  );
  const cardActions = canCapture && stripeReady && !closed;
  const swapCard = cardActions && hasSavedCard && (open || dueCents > 0);
  const amountOf = (item: PaymentRow) => (item.kind === "SECURITY_HOLD" && item.status === "AUTHORIZED" ? item.amount_cents : item.amount_captured_cents || item.amount_cents);

  return (
    <div className="flex flex-col gap-4">
      {!stripeReady && <p className="rounded-xl bg-status-limited/10 px-3.5 py-2.5 text-[13px] text-charcoal">{t("notConfigured")}</p>}
      {tollPending && <p className="rounded-xl bg-status-warning/10 px-3.5 py-2.5 text-[13px] text-charcoal">{t("tollPending")}</p>}

      {visible.length === 0 ? (
        <p className="text-[13px] text-muted">{t("empty")}</p>
      ) : (
        <ul className="divide-y divide-ink/[0.06] text-sm">
          {visible.map((item) => {
            const refundable = item.amount_captured_cents - item.amount_refunded_cents;
            const canEditRefund = canRefund && (stripeReady || Boolean(item.offline_method)) && refundable > 0 && ["SUCCEEDED", "PARTIALLY_REFUNDED"].includes(item.status);
            const isHold = canCapture && stripeReady && item.id === activeHold?.id;
            const openRow = editing === item.id;
            const suggested = item.offline_method && item.kind === "RENTAL" && offlineDueCents > 0 ? Math.min(refundable, offlineDueCents) : refundable;
            return (
              <li key={item.id} className={cn("py-2.5", ["FAILED", "REFUNDED"].includes(item.status) && "opacity-60")}>
                <div className="flex items-center gap-3">
                  <span className="min-w-0 flex-1">
                    <span className="font-medium">{t(`kind.${item.kind}`)}</span>
                    <span className="block text-[12px] text-muted">
                      {formatDateTime(item.created_at)}
                      {item.offline_method ? ` · ${t(`offlineMethod.${item.offline_method}`)}` : ""}
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
                {item.pay_url && (item.status === "PENDING" || item.status === "REQUIRES_ACTION") && (
                  <input readOnly value={item.pay_url} onFocus={(event) => event.currentTarget.select()} aria-label={t("payLink")} className="mt-2 h-9 w-full rounded-lg border border-ink/10 bg-pearl px-2.5 font-mono text-[11px]" />
                )}
                {openRow && canEditRefund && (
                  <form action={action} className={item.offline_method ? "mt-2.5 grid grid-cols-[7rem_minmax(0,1fr)_auto] gap-2" : "mt-2.5 flex flex-wrap gap-2"}>
                    {hidden("intent", "refund")}
                    {hidden("reservationId", reservationId)}
                    {hidden("paymentId", item.id)}
                    <Input name="amount" inputMode="decimal" required defaultValue={(suggested / 100).toFixed(2)} aria-label={t("amount")} className={item.offline_method ? "h-9" : "h-9 w-28"} />
                    {item.offline_method && (
                      <Select name="method" defaultValue={item.offline_method} className="col-span-2 h-9" aria-label={t("refundMethod")}>
                        {offlineMethods.map((method) => (
                          <option key={method} value={method}>
                            {t(`offlineMethod.${method}`)}
                          </option>
                        ))}
                      </Select>
                    )}
                    <Input name="note" placeholder={t("reason")} maxLength={300} className={item.offline_method ? "col-span-2 h-9" : "h-9 min-w-40 flex-1"} />
                    <Button type="submit" size="sm" variant="danger" disabled={pending}>
                      {item.offline_method ? t("recordRefund") : t("refund")}
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

      {canCapture && !closed && (
        <div className="flex flex-col gap-3 border-t border-ink/[0.07] pt-4">
          {cardActions && ((hasSavedCard && (rentDueCents > 0 || extrasDueCents > 0 || (!activeHold && open))) || (!hasSavedCard && rentDueCents > 0)) && (
            <div className="flex flex-wrap items-center gap-2">
              {rentDueCents > 0 && hasSavedCard && (
                <form action={action}>
                  {hidden("intent", "charge")}
                  {hidden("reservationId", reservationId)}
                  {hidden("amount", (rentDueCents / 100).toFixed(2))}
                  {hidden("kind", "RENTAL")}
                  {hidden("note", "Balance")}
                  <Button type="submit" size="sm" disabled={pending}>
                    {t("collectDue", { amount: formatMoney(rentDueCents) })}
                  </Button>
                </form>
              )}
              {extrasDueCents > 0 && hasSavedCard && (
                <form action={action}>
                  {hidden("intent", "charge")}
                  {hidden("reservationId", reservationId)}
                  {hidden("amount", (extrasDueCents / 100).toFixed(2))}
                  {hidden("kind", "SETTLE")}
                  {hidden("note", "Fees")}
                  <Button type="submit" size="sm" disabled={pending}>
                    {t("collectFees", { amount: formatMoney(extrasDueCents) })}
                  </Button>
                </form>
              )}
              {!hasSavedCard && rentDueCents > 0 && (
                <form action={action} className="flex flex-wrap items-center gap-2">
                  {hidden("reservationId", reservationId)}
                  <Button type="submit" name="intent" value="checkout" size="sm" disabled={pending}>
                    {t("createLink")}
                  </Button>
                  <Button type="submit" name="intent" value="checkout_email" size="sm" variant="secondary" disabled={pending}>
                    {t("emailLink")}
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
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            {cardActions && hasSavedCard && tab("extra", t("extraCharge"))}
            {tab("offline", t("offline"))}
            {swapCard && tab("link", t("cardLink"))}
          </div>
          {panel === "link" && swapCard && (
            <form action={action} className="flex flex-wrap items-center gap-2">
              {hidden("reservationId", reservationId)}
              <Button type="submit" name="intent" value="checkout" size="sm" variant="secondary" disabled={pending}>
                {t("createLink")}
              </Button>
              <Button type="submit" name="intent" value="checkout_email" size="sm" variant="secondary" disabled={pending}>
                {t("emailLink")}
              </Button>
            </form>
          )}
          {panel === "extra" && cardActions && hasSavedCard && (
            <form action={action} className="grid grid-cols-[7rem_minmax(0,1fr)_minmax(0,1fr)] gap-2">
              {hidden("intent", "charge")}
              {hidden("reservationId", reservationId)}
              <Input name="amount" inputMode="decimal" required placeholder={t("amount")} className="h-9" />
              <Select name="kind" value={chargeKind} onChange={(event) => setChargeKind(event.target.value)} className={cn("h-9", chargeKind !== "TOLL" && "col-span-2")} aria-label={t("chargeKind")}>
                <option value="ADDITIONAL">{t("kind.ADDITIONAL")}</option>
                <option value="TOLL">{t("kind.TOLL")}</option>
                <option value="CANCELLATION_FEE">{t("kind.CANCELLATION_FEE")}</option>
              </Select>
              {chargeKind === "TOLL" && <Input name="tollDays" type="number" inputMode="numeric" min={0} max={366} required placeholder={t("tollDays")} aria-label={t("tollDays")} className="h-9" />}
              <Input name="note" required={chargeKind !== "TOLL"} minLength={chargeKind === "TOLL" ? 0 : 3} maxLength={300} placeholder={t("chargeReason")} className="col-span-2 h-9" />
              <Button type="submit" size="sm" variant="secondary" disabled={pending} className="justify-self-start">
                {t("chargeCard")}
              </Button>
            </form>
          )}
          {panel === "offline" && (
            <form action={action} className="grid grid-cols-[7rem_minmax(0,1fr)_minmax(0,1fr)] gap-2">
              {hidden("intent", "offline")}
              {hidden("reservationId", reservationId)}
              <Input name="amount" inputMode="decimal" required placeholder={t("amount")} className="h-9" />
              <Select name="method" defaultValue="TRANSFER" className="h-9" aria-label={t("offline")}>
                {offlineMethods.map((method) => (
                  <option key={method} value={method}>
                    {t(`offlineMethod.${method}`)}
                  </option>
                ))}
              </Select>
              <Select name="kind" defaultValue="RENTAL" className="h-9" aria-label={t("chargeKind")}>
                <option value="RENTAL">{t("kind.RENTAL")}</option>
                <option value="ADDITIONAL">{t("kind.ADDITIONAL")}</option>
                {extrasDueCents > 0 && <option value="SETTLE">{t("settleFees")}</option>}
              </Select>
              <Input name="note" maxLength={300} placeholder={t("note")} className="col-span-2 h-9" />
              <Button type="submit" size="sm" variant="secondary" disabled={pending} className="justify-self-start">
                {t("recordOffline")}
              </Button>
            </form>
          )}
        </div>
      )}

      {state.url && <p className="text-xs text-status-available">{t("linkReady")}</p>}
      {state.sentTo && <p className="text-xs text-status-available">{t("linkSent", { email: state.sentTo })}</p>}
      {state.ok && !state.url && !state.sentTo && <p className="text-xs text-status-available">{state.pending ? t("pendingApproval") : t("done")}</p>}
      {state.error && (
        <p className="rounded-xl bg-status-danger/8 px-3.5 py-2.5 text-[13px] text-status-danger" role="alert">
          {t.has(`errors.${state.error}`) ? t(`errors.${state.error}`) : `${t("errors.generic")} (${state.error})`}
        </p>
      )}
    </div>
  );
}
