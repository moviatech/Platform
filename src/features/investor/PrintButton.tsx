"use client";

import { Icon } from "@/features/portal/icons";

const goldPill = "inline-flex h-10 items-center justify-center gap-1.5 rounded-pill px-4 text-[13px] font-medium transition-colors bg-gold text-white hover:bg-gold-light";

export function PrintButton({ label }: { label: string }) {
  return (
    <button type="button" onClick={() => window.print()} className={`${goldPill} no-print`}>
      <Icon name="doc" size={15} />
      {label}
    </button>
  );
}
