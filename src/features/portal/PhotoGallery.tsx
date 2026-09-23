"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { Icon } from "./icons";

export type GalleryPhoto = { id: string; url: string; label: string };

type Props = { photos: GalleryPhoto[]; labels: { close: string; previous: string; next: string }; gridClassName?: string; thumbClassName?: string };

const round = "flex size-10 items-center justify-center rounded-full bg-white/12 text-white transition-colors hover:bg-white/25";

export function PhotoGallery({ photos, labels, gridClassName = "mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5", thumbClassName = "aspect-[4/3]" }: Props) {
  const [index, setIndex] = useState<number | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const count = photos.length;
  const current = index === null ? null : (photos[index] ?? null);
  const open = current !== null;

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIndex(null);
      if (event.key === "ArrowRight") setIndex((value) => (value === null ? value : (value + 1) % count));
      if (event.key === "ArrowLeft") setIndex((value) => (value === null ? value : (value - 1 + count) % count));
      if (event.key === "Tab") {
        const buttons = [...(dialogRef.current?.querySelectorAll<HTMLButtonElement>("button") ?? [])];
        if (!buttons.length) return;
        event.preventDefault();
        const position = buttons.indexOf(document.activeElement as HTMLButtonElement);
        buttons[(position + (event.shiftKey ? -1 : 1) + buttons.length) % buttons.length].focus();
      }
    };
    const previous = document.body.style.overflow;
    const trigger = triggerRef.current;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    closeRef.current?.focus();
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", onKey);
      trigger?.focus();
    };
  }, [open, count]);

  const step = (delta: number) => setIndex((value) => (value === null ? value : (value + delta + count) % count));

  return (
    <>
      <ul className={gridClassName}>
        {photos.map((photo, position) => (
          <li key={photo.id}>
            <button
              type="button"
              onClick={(event) => {
                triggerRef.current = event.currentTarget;
                setIndex(position);
              }}
              aria-label={photo.label || `${position + 1} / ${count}`}
              className="block w-full cursor-zoom-in overflow-hidden rounded-xl bg-pearl"
            >
              <Image src={photo.url} alt={photo.label} width={640} height={480} unoptimized className={`${thumbClassName} w-full object-cover transition-transform hover:scale-[1.02]`} />
            </button>
            {photo.label && <p className="mt-1.5 text-[12px] text-charcoal">{photo.label}</p>}
          </li>
        ))}
      </ul>
      {current && index !== null && (
        <div ref={dialogRef} role="dialog" aria-modal="true" aria-label={current.label || `${index + 1} / ${count}`} onClick={() => setIndex(null)} className="fixed inset-0 z-[90] flex flex-col bg-ink/92">
          <div className="flex items-center justify-between gap-4 px-4 py-3 text-white sm:px-6">
            <p className="min-w-0 truncate text-[14px] font-medium">
              {current.label}
              {count > 1 && <span className={current.label ? "ml-2 text-[12px] font-normal text-white/70" : "text-[12px] font-normal text-white/70"}>{index + 1} / {count}</span>}
            </p>
            <button ref={closeRef} type="button" onClick={() => setIndex(null)} aria-label={labels.close} className={round}>
              <Icon name="x" size={18} />
            </button>
          </div>
          <div className="relative flex min-h-0 flex-1 items-center justify-center px-4 pb-6 sm:px-16">
            <Image
              key={current.id}
              src={current.url}
              alt={current.label}
              width={1600}
              height={1200}
              unoptimized
              priority
              onClick={(event) => event.stopPropagation()}
              className="h-auto max-h-full w-auto max-w-full rounded-lg object-contain"
            />
            {count > 1 && (
              <>
                <button
                  type="button"
                  aria-label={labels.previous}
                  onClick={(event) => {
                    event.stopPropagation();
                    step(-1);
                  }}
                  className={`${round} absolute top-1/2 left-3 -translate-y-1/2 sm:left-4`}
                >
                  <Icon name="chevron" size={18} className="rotate-180" />
                </button>
                <button
                  type="button"
                  aria-label={labels.next}
                  onClick={(event) => {
                    event.stopPropagation();
                    step(1);
                  }}
                  className={`${round} absolute top-1/2 right-3 -translate-y-1/2 sm:right-4`}
                >
                  <Icon name="chevron" size={18} />
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
