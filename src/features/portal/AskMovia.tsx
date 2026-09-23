"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils/cn";
import { AssistantChat } from "./AssistantChat";

export const askEvent = "movia:ask";

export function AskMoviaButton({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <button type="button" onClick={() => window.dispatchEvent(new CustomEvent(askEvent))} className={className}>
      {children}
    </button>
  );
}

export function AskMovia({ locale }: { locale: "zh" | "en" }) {
  const t = useTranslations("portal.help");
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const show = () => setOpen(true);
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener(askEvent, show);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener(askEvent, show);
      window.removeEventListener("keydown", key);
    };
  }, []);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn("fixed right-5 bottom-5 z-40 inline-flex h-11 items-center gap-2 rounded-pill bg-ink px-4 text-sm font-medium text-white shadow-lift transition-opacity hover:bg-charcoal", open && "pointer-events-none opacity-0")}
      >
        <span aria-hidden="true">✦</span>
        {t("ask")}
      </button>
      <div className={cn("fixed inset-0 z-50 transition-opacity", open ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0")} aria-hidden={!open}>
        <button type="button" aria-label={t("close")} onClick={() => setOpen(false)} className="absolute inset-0 bg-ink/30" />
        <aside className={cn("absolute top-0 right-0 flex h-full w-full max-w-md flex-col bg-white shadow-lift transition-transform", open ? "translate-x-0" : "translate-x-full")} role="dialog" aria-modal="true">
          <div className="flex items-center justify-between border-b border-ink/[0.07] px-5 py-3">
            <p className="text-[11px] tracking-[0.2em] text-gold uppercase">{t("askEyebrow")}</p>
            <button type="button" onClick={() => setOpen(false)} className="rounded-pill px-2.5 py-1 text-sm text-charcoal hover:bg-ink/5">
              ×
            </button>
          </div>
          <div className="min-h-0 flex-1">{open && <AssistantChat locale={locale} tall />}</div>
        </aside>
      </div>
    </>
  );
}
