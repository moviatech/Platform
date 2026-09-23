"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils/cn";
import type { PortalNotification } from "./notifications";

export function NotificationBell({ items, dates }: { items: PortalNotification[]; dates: Record<string, string> }) {
  const t = useTranslations("portal.notifications");
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => setOpen((value) => !value)} aria-label={t("title")} className="relative flex size-9 items-center justify-center rounded-full text-charcoal hover:bg-ink/5">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M6 9a6 6 0 0 1 12 0v4l1.5 3h-15L6 13zM10 19a2 2 0 0 0 4 0" />
        </svg>
        {items.length > 0 && <span className="absolute top-1.5 right-1.5 size-2 rounded-full bg-gold" />}
      </button>
      <div className={cn("absolute right-0 z-40 mt-2 w-80 rounded-xl bg-white p-2 shadow-lift hairline", open ? "block" : "hidden")}>
        <p className="px-3 pt-2 pb-1 text-[11px] tracking-[0.2em] text-gold uppercase">{t("title")}</p>
        {items.length === 0 ? (
          <p className="px-3 py-4 text-[13px] text-muted">{t("empty")}</p>
        ) : (
          <ul className="max-h-80 overflow-y-auto">
            {items.slice(0, 6).map((item) => (
              <li key={item.id}>
                <Link href={`/messages/${item.id}`} onClick={() => setOpen(false)} className="block rounded-xl px-3 py-2.5 hover:bg-pearl">
                  <span className="block truncate text-[13px] font-medium">{item.subject ?? "Movia"}</span>
                  <span className="block truncate text-xs text-muted">{item.preview ?? ""}</span>
                  <span className="block text-[11px] text-muted">{dates[item.id]}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
        <Link href="/messages" onClick={() => setOpen(false)} className="block px-3 py-2 text-[13px] text-charcoal hover:text-ink">
          {t("viewAll")} →
        </Link>
      </div>
    </div>
  );
}
