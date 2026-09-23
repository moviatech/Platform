"use client";

import { useState, useTransition } from "react";
import { generateTopics } from "../ai-actions";

const button = "h-9 rounded-pill px-4 text-[13px] hairline hover:border-ink/25 disabled:opacity-50";

export function TopicButtons({ manage, labels }: { manage: boolean; labels: { generate: string; regenerate: string; status: Record<string, string> } }) {
  const [message, setMessage] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const run = (force: boolean) =>
    start(async () => {
      const result = await generateTopics(force).catch(() => ({ status: "failed" as const }));
      setMessage(Object.hasOwn(labels.status, result.status) ? labels.status[result.status] : labels.status.failed);
    });
  return (
    <div className="flex flex-wrap items-center gap-2" data-topic-controls="">
      <button type="button" disabled={pending} aria-busy={pending || undefined} className={button} onClick={() => run(false)}>
        {labels.generate}
      </button>
      {manage && (
        <button type="button" disabled={pending} className={button} onClick={() => run(true)}>
          {labels.regenerate}
        </button>
      )}
      {message && (
        <span className="text-[12px] text-muted" data-topic-message="" role="status">
          {message}
        </span>
      )}
    </div>
  );
}

export function CopyButton({ text, labels }: { text: string; labels: { copy: string; copied: string } }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      data-copy=""
      className="h-7 rounded-pill px-2.5 text-[12px] hairline hover:border-ink/25"
      onClick={() => {
        navigator.clipboard
          .writeText(text)
          .then(() => {
            setDone(true);
            setTimeout(() => setDone(false), 2000);
          })
          .catch(() => setDone(false));
      }}
    >
      {done ? labels.copied : labels.copy}
    </button>
  );
}
