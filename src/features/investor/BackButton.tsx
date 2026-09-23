"use client";

import { useRouter } from "next/navigation";
import { Icon } from "@/features/portal/icons";

export function BackButton({ label, fallback }: { label: string; fallback: string }) {
  const router = useRouter();
  return (
    <button
      type="button"
      onClick={() => {
        if (window.history.length > 1 && document.referrer.startsWith(window.location.origin)) router.back();
        else router.push(fallback);
      }}
      className="no-print mb-3 inline-flex items-center gap-1 text-[13px] text-muted hover:text-ink"
    >
      <Icon name="chevron" size={14} className="rotate-180" />
      {label}
    </button>
  );
}
