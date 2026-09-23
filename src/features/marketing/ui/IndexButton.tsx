"use client";

import { useTransition } from "react";
import { checkIndexing } from "../actions";

export function IndexButton({ slug, label }: { slug: string; label: string }) {
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      aria-busy={pending || undefined}
      onClick={() =>
        start(async () => {
          await checkIndexing(slug).catch(() => null);
        })
      }
      className="h-7 rounded-pill px-2.5 text-[12px] hairline hover:border-ink/25 disabled:opacity-50"
    >
      {label}
    </button>
  );
}
