"use client";

import { useActionState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { formatMoney } from "@/lib/utils/format";
import { pickupPayment } from "./actions";
import type { PickupPayState } from "./types";

type Props = {
  reservationId: string;
  holdCents: number;
  holdAuthorized: boolean;
  rentDueCents: number;
  hasCard: boolean;
  payNow: boolean;
  offlineHref: string | null;
};

const row = "flex flex-wrap items-center justify-between gap-x-4 gap-y-2";

export function PickupPayments({ reservationId, holdCents, holdAuthorized, rentDueCents, hasCard, payNow, offlineHref }: Props) {
  const t = useTranslations("handover");
  const r = useTranslations("reservations");
  const p = useTranslations("payments");
  const [state, action] = useActionState<PickupPayState, FormData>(pickupPayment, {});
  const paid = rentDueCents <= 0;
  const text = (code: string) => (t.has(`errors.${code}`) ? t(`errors.${code}`) : p.has(`errors.${code}`) ? p(`errors.${code}`) : r.has(`errors.${code}`) ? r(`errors.${code}`) : code);
  const failure = (intent: PickupPayState["intent"]) =>
    state.error && state.intent === intent ? (
      <p className="w-full text-[13px] text-status-danger" role="alert">
        {text(state.error)}
      </p>
    ) : null;

  return (
    <form action={action} className="mt-2.5 flex flex-col gap-2.5 text-[13px]">
      <input type="hidden" name="reservationId" value={reservationId} />
      <div className={row}>
        <span className="text-charcoal">{t("hold")}</span>
        <span className="flex items-center gap-2">
          <span className="text-muted">{formatMoney(holdCents)}</span>
          {holdAuthorized ? (
            <Badge tone="success">✓</Badge>
          ) : (
            <Button type="submit" name="intent" value="hold" size="sm" variant="secondary" disabled={!hasCard}>
              {t("authorize")}
            </Button>
          )}
        </span>
        {!holdAuthorized && failure("hold")}
      </div>
      <div className={row}>
        <span className="text-charcoal">{t("rent")}</span>
        <span className="flex items-center gap-2">
          <span className="text-muted">{paid ? r("state.PAID") : formatMoney(rentDueCents)}</span>
          {paid ? (
            <Badge tone="success">✓</Badge>
          ) : (
            <Button type="submit" name="intent" value="charge" size="sm" variant="secondary" disabled={!hasCard}>
              {t("charge")}
            </Button>
          )}
        </span>
        {!paid && failure("charge")}
      </div>
      {(!holdAuthorized || !paid) && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          {!hasCard && <span className="text-muted">{p("noCard")}</span>}
          <Button type="submit" name="intent" value="link" size="sm" variant="ghost" className="-ml-4">
            {payNow && !paid ? t("sendPayLink") : hasCard ? t("sendNewCardLink") : t("sendCardLink")}
          </Button>
          {offlineHref && !paid && (
            <Link href={offlineHref} className="text-[12px] text-charcoal underline decoration-gold/50 underline-offset-2 hover:decoration-gold">
              {p("offline")}
            </Link>
          )}
          {state.intent === "link" && state.sentTo && <span className="text-muted">{p("linkSent", { email: state.sentTo })}</span>}
          {failure("link")}
        </div>
      )}
    </form>
  );
}
