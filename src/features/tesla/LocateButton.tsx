"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { formatDateTime } from "@/lib/utils/format";
import { locateVehicle, type ReadResult } from "./actions";

export function LocateButton({ reservationId }: { reservationId: string }) {
  const t = useTranslations("handover");
  const [pending, start] = useTransition();
  const [result, setResult] = useState<ReadResult | null>(null);
  const locate = () => {
    setResult(null);
    start(async () => {
      setResult(await locateVehicle(reservationId));
    });
  };
  return (
    <div className="flex flex-col gap-2 text-[13px]">
      <button type="button" onClick={locate} disabled={pending} className="self-start rounded-pill border border-ink/15 px-3 py-1 text-[12px] font-medium text-charcoal hover:border-ink/30 disabled:opacity-40">
        {pending ? t("tesla.locating") : t("tesla.locate")}
      </button>
      {result?.error && (
        <p className="text-status-danger" role="alert">
          {t.has(`tesla.errors.${result.error}`) ? t(`tesla.errors.${result.error}`) : `${t("tesla.errors.failed")} (${result.error})`}
        </p>
      )}
      {result && !result.error && (
        <p className="text-charcoal">
          {result.latitude !== null && result.latitude !== undefined && result.longitude !== null && result.longitude !== undefined ? (
            <a href={`https://www.google.com/maps?q=${result.latitude},${result.longitude}`} target="_blank" rel="noreferrer" className="underline decoration-gold/50 underline-offset-4 hover:decoration-gold">
              {result.latitude.toFixed(5)}, {result.longitude.toFixed(5)}
            </a>
          ) : (
            t("tesla.noLocation")
          )}
          {result.odometer !== null && result.odometer !== undefined ? ` · ${result.odometer} mi` : ""}
          {result.battery !== null && result.battery !== undefined ? ` · ${result.battery}%` : ""}
          {result.at ? ` · ${formatDateTime(result.at)}` : ""}
        </p>
      )}
    </div>
  );
}
