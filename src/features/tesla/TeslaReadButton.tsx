"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { readVehicleState } from "./actions";

function fill(id: string, value: number | null | undefined) {
  if (value === null || value === undefined) return;
  const element = document.getElementById(id) as HTMLInputElement | null;
  if (!element) return;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(element, String(value));
  element.dispatchEvent(new Event("input", { bubbles: true }));
  element.dispatchEvent(new Event("change", { bubbles: true }));
}

export function TeslaReadButton({ reservationId }: { reservationId: string }) {
  const t = useTranslations("handover");
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<{ ok?: boolean; error?: string } | null>(null);
  const read = () => {
    setMessage(null);
    start(async () => {
      const result = await readVehicleState(reservationId);
      if (result.error) {
        setMessage({ error: result.error });
        return;
      }
      fill("odometer", result.odometer);
      fill("batteryLevel", result.battery);
      setMessage({ ok: true });
    });
  };
  return (
    <div className="flex flex-wrap items-center gap-3 text-[12px]">
      <button type="button" onClick={read} disabled={pending} className="rounded-pill border border-ink/15 px-3 py-1 font-medium text-charcoal hover:border-ink/30 disabled:opacity-40">
        {pending ? t("tesla.reading") : t("tesla.read")}
      </button>
      {message?.ok && <span className="text-status-available">{t("tesla.filled")}</span>}
      {message?.error && (
        <span className="text-status-danger" role="alert">
          {t.has(`tesla.errors.${message.error}`) ? t(`tesla.errors.${message.error}`) : `${t("tesla.errors.failed")} (${message.error})`}
        </span>
      )}
    </div>
  );
}
