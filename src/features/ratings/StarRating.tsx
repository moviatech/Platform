"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Textarea } from "@/components/ui/Field";
import { cn } from "@/lib/utils/cn";
import { lowScoreMax } from "./types";

type Props = { name?: string; commentName?: string; defaultScore?: number | null; defaultComment?: string | null; size?: "md" | "lg"; onChange?: (score: number) => void; readOnly?: boolean };

export function StarRating({ name = "score", commentName = "comment", defaultScore = null, defaultComment = null, size = "md", onChange, readOnly }: Props) {
  const t = useTranslations("ratings");
  const [score, setScore] = useState<number | null>(defaultScore);
  const [hover, setHover] = useState<number | null>(null);
  const shown = hover ?? score ?? 0;
  const dimension = size === "lg" ? "size-11" : "size-9";
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-1.5" role="radiogroup" aria-label={t("label")}>
        {[1, 2, 3, 4, 5].map((value) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={score === value}
            aria-label={t(`stars.${value}`)}
            disabled={readOnly}
            onMouseEnter={() => !readOnly && setHover(value)}
            onMouseLeave={() => setHover(null)}
            onClick={() => {
              if (readOnly) return;
              setScore(value);
              onChange?.(value);
            }}
            className={cn("flex items-center justify-center rounded-full transition-transform", dimension, !readOnly && "hover:scale-110", value <= shown ? "text-gold" : "text-ink/15")}
          >
            <svg viewBox="0 0 24 24" width={size === "lg" ? 34 : 26} height={size === "lg" ? 34 : 26} fill="currentColor" aria-hidden="true">
              <path d="M12 2.5l2.9 6.1 6.7.8-4.9 4.6 1.3 6.6L12 17.3l-6 3.3 1.3-6.6-4.9-4.6 6.7-.8z" />
            </svg>
          </button>
        ))}
        {score && <span className="ml-2 text-[13px] text-charcoal">{t(`stars.${score}`)}</span>}
      </div>
      <input type="hidden" name={name} value={score ?? ""} />
      {score !== null && score <= lowScoreMax && !readOnly && (
        <label className="flex flex-col gap-1.5 text-[13px]">
          <span className="font-medium">{t("reason")}</span>
          <Textarea name={commentName} defaultValue={defaultComment ?? ""} maxLength={2000} rows={3} placeholder={t("reasonPlaceholder")} />
        </label>
      )}
      {score !== null && score > lowScoreMax && !readOnly && <input type="hidden" name={commentName} value="" />}
    </div>
  );
}
