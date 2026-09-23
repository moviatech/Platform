"use client";

import { useActionState, useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/Button";
import { Textarea } from "@/components/ui/Field";
import { cn } from "@/lib/utils/cn";
import { StarRating } from "./StarRating";
import { submitSurvey, type SurveyState } from "./survey-actions";
import type { Touchpoint } from "./types";

type Props = { token: string; touchpoints: Touchpoint[]; completed: { recommend: number | null; reason: string | null } | null };

export function SurveyForm({ token, touchpoints, completed }: Props) {
  const t = useTranslations("survey");
  const r = useTranslations("ratings");
  const [state, action, pending] = useActionState<SurveyState, FormData>(submitSurvey, {});
  const [recommend, setRecommend] = useState<number | null>(completed?.recommend ?? null);
  const done = Boolean(completed) || Boolean(state.ok);

  return (
    <form action={action} className="flex flex-col gap-6">
      <input type="hidden" name="token" value={token} />
      {touchpoints.map((point) => (
        <section key={point.key} className="border-t border-ink/[0.06] pt-5 first:border-t-0 first:pt-0">
          <p className="text-[14px] font-semibold">{r(`kinds.${point.kind}`)}</p>
          {point.kind !== "VEHICLE" && <p className="mb-2 text-[12px] text-muted">{point.staffName ?? r("team")}</p>}
          <div className="mt-2">
            <StarRating name={`score:${point.key}`} commentName={`comment:${point.key}`} defaultScore={point.rated?.score ?? null} defaultComment={point.rated?.comment ?? null} size="lg" readOnly={done} />
          </div>
          {done && point.rated?.comment && <p className="mt-1 text-[13px] text-charcoal">{point.rated.comment}</p>}
        </section>
      ))}
      <section className="border-t border-ink/[0.06] pt-5">
        <p className="text-[14px] font-semibold">{r("recommend")}</p>
        <p className="text-[12px] text-muted">{r("recommendScale")}</p>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {Array.from({ length: 11 }, (_, value) => (
            <button
              key={value}
              type="button"
              disabled={done}
              onClick={() => setRecommend(value)}
              className={cn("size-9 rounded-full text-[13px] font-medium transition-colors", recommend === value ? "bg-gold text-white" : "bg-pearl text-charcoal hover:bg-gold/15")}
            >
              {value}
            </button>
          ))}
        </div>
        <input type="hidden" name="recommend" value={recommend ?? ""} />
        {done ? (
          completed?.reason && <p className="mt-3 text-[13px] text-charcoal">{completed.reason}</p>
        ) : (
          <label className="mt-4 flex flex-col gap-1.5 text-[13px]">
            <span className="font-medium">{r("recommendWhy")}</span>
            <Textarea name="reason" rows={3} maxLength={2000} />
          </label>
        )}
      </section>
      {done ? (
        <p className="text-[14px] font-semibold text-gold">{r("thanks")}</p>
      ) : (
        <div className="flex items-center gap-3">
          <Button type="submit" variant="gold" disabled={pending}>
            {r("submit")}
          </Button>
          {state.error && <span className="text-[13px] text-status-danger">{t(`errors.${state.error}`)}</span>}
        </div>
      )}
    </form>
  );
}
