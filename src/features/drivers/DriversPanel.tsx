"use client";

import { useActionState, useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/utils/cn";
import { markDriverInternational, startDriverVerification, type DriverActionState } from "./portal-actions";
import { driverDone, type DriverRow } from "./types";

function DriverItem({ driver, stripeReady }: { driver: DriverRow; stripeReady: boolean }) {
  const t = useTranslations("portal.trip.drivers");
  const [state, start, pending] = useActionState<DriverActionState, FormData>(startDriverVerification, {});
  const [copied, setCopied] = useState(false);
  const done = driverDone(driver.status);
  const copy = async () => {
    if (!state.url) return;
    try {
      await navigator.clipboard.writeText(state.url);
      setCopied(true);
    } catch {}
  };
  return (
    <li className="rounded-xl bg-pearl px-4 py-3 text-[13px]">
      <div className="flex items-center justify-between gap-3">
        <span className="font-medium">
          {t("slot", { n: driver.position })}
          {driver.full_name ? ` · ${driver.full_name}` : ""}
        </span>
        <span className={cn(done ? "text-status-available" : driver.status === "REJECTED" ? "text-status-danger" : "text-muted")}>{t(`status.${driver.status}`)}</span>
      </div>
      {!done && (
        <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-2">
          {stripeReady && !driver.international && (
            <form action={start}>
              <input type="hidden" name="driverId" value={driver.id} />
              <Button type="submit" size="sm" variant="secondary" disabled={pending}>
                {driver.status === "SUBMITTED" ? t("restart") : t("verify")}
              </Button>
            </form>
          )}
          {state.url && (
            <>
              <a href={state.url} target="_blank" rel="noreferrer" className="underline decoration-gold/50 underline-offset-4 hover:decoration-gold">
                {t("openLink")}
              </a>
              <button type="button" onClick={copy} className="text-charcoal underline decoration-gold/50 underline-offset-4 hover:decoration-gold">
                {copied ? t("copied") : t("copyLink")}
              </button>
            </>
          )}
          <form action={markDriverInternational}>
            <input type="hidden" name="driverId" value={driver.id} />
            <input type="hidden" name="international" value={driver.international ? "0" : "1"} />
            <button type="submit" className="text-muted underline decoration-gold/50 underline-offset-4 hover:text-ink">
              {driver.international ? t("useOnline") : t("international")}
            </button>
          </form>
        </div>
      )}
      {!done && driver.international && <p className="mt-1.5 text-muted">{t("onsite")}</p>}
      {state.error && (
        <p className="mt-1.5 text-status-danger" role="alert">
          {t(`errors.${state.error}`)}
        </p>
      )}
    </li>
  );
}

export function DriversPanel({ drivers, stripeReady }: { drivers: DriverRow[]; stripeReady: boolean }) {
  return (
    <ul className="flex flex-col gap-2.5">
      {drivers.map((driver) => (
        <DriverItem key={driver.id} driver={driver} stripeReady={stripeReady} />
      ))}
    </ul>
  );
}
