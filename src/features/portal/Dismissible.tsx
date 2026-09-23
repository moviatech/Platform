"use client";

import { useState, useSyncExternalStore, type ReactNode } from "react";
import { Icon } from "./icons";

const subscribe = (callback: () => void) => {
  window.addEventListener("storage", callback);
  return () => window.removeEventListener("storage", callback);
};

export function Dismissible({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  const key = `movia_dismiss_${id}`;
  const [dismissed, setDismissed] = useState(false);
  const stored = useSyncExternalStore(
    subscribe,
    () => {
      try {
        return localStorage.getItem(key) === "1";
      } catch {
        return false;
      }
    },
    () => false,
  );
  if (stored || dismissed) return null;
  return (
    <div className="relative">
      <button
        type="button"
        aria-label={label}
        onClick={() => {
          try {
            localStorage.setItem(key, "1");
          } catch {}
          setDismissed(true);
        }}
        className="absolute top-4 right-4 flex size-7 items-center justify-center rounded-full text-muted hover:bg-ink/5 hover:text-ink"
      >
        <Icon name="x" size={14} />
      </button>
      {children}
    </div>
  );
}
