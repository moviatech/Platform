"use client";

import { useState, type ReactNode } from "react";
import { cn } from "@/lib/utils/cn";

export function RowAction({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <span>
        <button type="button" onClick={() => setOpen((value) => !value)} className={cn("rounded-pill px-2.5 py-1 text-[12px] font-medium hover:bg-gold/10", open ? "bg-gold/10 text-ink" : "text-gold")}>
          {label}
        </button>
      </span>
      {open && <div className="rounded-xl bg-pearl/60 p-3 md:col-span-full">{children}</div>}
    </>
  );
}
