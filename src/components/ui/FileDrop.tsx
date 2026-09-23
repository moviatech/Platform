"use client";

import { useRef, useState, type ChangeEvent, type DragEvent, type Ref } from "react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils/cn";

type Props = {
  id?: string;
  name: string;
  accept?: string;
  multiple?: boolean;
  append?: boolean;
  max?: number;
  ref?: Ref<HTMLInputElement>;
  onChange?: (event: ChangeEvent<HTMLInputElement>) => void;
  className?: string;
  label?: string;
};

const sameFile = (a: File, b: File) => a.name === b.name && a.size === b.size && a.lastModified === b.lastModified;

function assign(input: HTMLInputElement, files: File[]) {
  try {
    const transfer = new DataTransfer();
    files.forEach((file) => transfer.items.add(file));
    input.files = transfer.files;
    return true;
  } catch {
    return false;
  }
}

export function mergePicked(input: HTMLInputElement, kept: File[], max?: number) {
  const picked = Array.from(input.files ?? []);
  if (kept.length) {
    const fresh = picked.filter((file) => !kept.some((earlier) => sameFile(earlier, file)));
    assign(input, [...kept, ...fresh].slice(0, max ?? undefined));
  } else if (max && picked.length > max) {
    assign(input, picked.slice(0, max));
  }
}

export function FileDrop({ id, name, accept, multiple, append, max, ref, onChange, className, label }: Props) {
  const t = useTranslations("fileDrop");
  const [over, setOver] = useState(false);
  const [names, setNames] = useState<string[]>([]);
  const kept = useRef<File[]>([]);
  const adding = Boolean(multiple && (append ?? true));

  const report = (input: HTMLInputElement) => {
    if (adding) mergePicked(input, kept.current, max);
    kept.current = [];
    setNames(Array.from(input.files ?? []).map((file) => file.name));
  };

  const onDrop = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    setOver(false);
    const input = event.currentTarget.querySelector("input");
    if (!input || !event.dataTransfer.files.length) return;
    kept.current = adding ? Array.from(input.files ?? []) : [];
    const transfer = new DataTransfer();
    Array.from(event.dataTransfer.files)
      .slice(0, multiple ? undefined : 1)
      .forEach((file) => transfer.items.add(file));
    input.files = transfer.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  };

  return (
    <label
      htmlFor={id}
      onDragOver={(event) => {
        event.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
      className={cn(
        "flex cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border border-dashed px-4 py-5 text-center text-[13px] transition-colors",
        over ? "border-gold bg-gold/8 text-ink" : "border-ink/15 bg-pearl/60 text-charcoal hover:border-gold/60 hover:bg-gold/5",
        className,
      )}
    >
      <input
        id={id}
        name={name}
        type="file"
        accept={accept}
        multiple={multiple}
        ref={ref}
        onClick={(event) => {
          kept.current = adding ? Array.from(event.currentTarget.files ?? []) : [];
        }}
        onChange={(event) => {
          report(event.currentTarget);
          onChange?.(event);
        }}
        className="sr-only"
      />
      <span className="font-medium">{label ?? t(multiple ? "pickMany" : "pickOne")}</span>
      <span className="text-[12px] text-muted">{names.length ? (names.length > 3 ? t("selected", { count: names.length }) : names.join(" · ")) : t("hint")}</span>
      {adding && names.length > 0 && (
        <button
          type="button"
          onClick={(event) => {
            event.preventDefault();
            const input = event.currentTarget.parentElement?.querySelector("input");
            if (!input) return;
            kept.current = [];
            input.value = "";
            input.dispatchEvent(new Event("change", { bubbles: true }));
          }}
          className="text-[12px] text-charcoal underline decoration-gold/50 underline-offset-2 hover:decoration-gold"
        >
          {t("clear")}
        </button>
      )}
    </label>
  );
}
