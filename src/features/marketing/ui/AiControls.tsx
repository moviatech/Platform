"use client";

import { useState, useTransition } from "react";
import { regenerateBrief, saveAiLimit } from "../ai-actions";

type Labels = { limit: string; save: string; regenerate: string; status: Record<string, string> };

const field = "h-9 w-28 rounded-[10px] px-3 text-sm tabular-nums hairline focus:border-ink/40 focus:outline-none";
const button = "h-9 rounded-pill px-4 text-[13px] hairline hover:border-ink/25 disabled:opacity-50";

export function AiControls({ limit, labels }: { limit: number; labels: Labels }) {
  const [value, setValue] = useState(String(limit));
  const [message, setMessage] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const say = (status: string) => setMessage(Object.hasOwn(labels.status, status) ? labels.status[status] : labels.status.failed);

  return (
    <div className="mt-4 space-y-3" data-ai-controls="">
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          start(async () => {
            const result = await saveAiLimit(value).catch(() => ({ status: "failed" as const }));
            say(result.status);
          });
        }}
      >
        <label className="grid gap-1 text-xs text-muted">
          {labels.limit}
          <input name="limit" type="number" inputMode="numeric" min={1} max={5000} step={1} value={value} onChange={(event) => setValue(event.target.value)} className={field} />
        </label>
        <button type="submit" disabled={pending} className={button}>
          {labels.save}
        </button>
      </form>
      <button
        type="button"
        disabled={pending}
        aria-busy={pending || undefined}
        className={button}
        onClick={() =>
          start(async () => {
            const result = await regenerateBrief().catch(() => ({ status: "failed" as const }));
            say(result.status);
          })
        }
      >
        {labels.regenerate}
      </button>
      {message && (
        <p className="text-[12px] text-muted" data-ai-message="" role="status">
          {message}
        </p>
      )}
    </div>
  );
}
