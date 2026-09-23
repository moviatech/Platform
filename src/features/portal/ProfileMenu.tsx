"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils/cn";
import { Icon } from "./icons";

export function ProfileMenu({ initial, name, meta, children }: { initial: string; name: string; meta?: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const pathname = usePathname();
  const [seen, setSeen] = useState(pathname);
  if (seen !== pathname) {
    setSeen(pathname);
    setOpen(false);
  }
  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent ? event.key === "Escape" : !ref.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);
  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open} className="flex items-center gap-2.5 rounded-pill py-1 pr-2 pl-1 hover:bg-ink/5">
        <span className="flex size-9 items-center justify-center rounded-full bg-gold text-[13px] font-semibold text-white">{initial}</span>
        <span className="text-left">
          <span className="block text-[13px] leading-tight font-semibold">{name}</span>
          {meta && <span className="block text-[11px] leading-tight text-muted">{meta}</span>}
        </span>
        <Icon name="chevron" size={14} className={cn("text-muted transition-transform", open ? "-rotate-90" : "rotate-90")} />
      </button>
      {open && (
        <div className="absolute top-full right-0 z-40 mt-2 w-44 rounded-xl bg-white p-1.5 shadow-lift hairline">
          {children}
        </div>
      )}
    </div>
  );
}
