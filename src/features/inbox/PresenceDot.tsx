"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils/cn";

const onlineMs = 30000;

export function PresenceDot({ conversationId, initial, labels }: { conversationId: string; initial: string | null; labels: { online: string; offline: string } }) {
  const [online, setOnline] = useState(false);
  useEffect(() => {
    let active = true;
    const judge = (seenAt: string | null) => setOnline(Boolean(seenAt) && Date.now() - Date.parse(seenAt as string) < onlineMs);
    judge(initial);
    const tick = async () => {
      try {
        const res = await fetch(`/inbox/presence/${conversationId}`, { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as { seenAt: string | null };
        if (active) judge(data.seenAt ?? null);
      } catch {}
    };
    const timer = window.setInterval(tick, 15000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [conversationId, initial]);
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 text-[11px] font-normal text-muted" title={online ? labels.online : labels.offline}>
      <span className={cn("size-2 rounded-full", online ? "bg-status-available" : "bg-ink/20")} aria-hidden="true" />
      {online ? labels.online : labels.offline}
    </span>
  );
}
