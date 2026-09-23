"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/Button";
import { StarRating } from "@/features/ratings/StarRating";
import { rateOnDevice } from "./rate-actions";
import type { HandoverState } from "./types";

type Props = { reservationId: string; stage: "pickup" | "return"; defaultScore: number | null; defaultComment: string | null };

export function RateForm({ reservationId, stage, defaultScore, defaultComment }: Props) {
  const t = useTranslations("handover.rating");
  const r = useTranslations("reservations");
  const [state, action, pending] = useActionState<HandoverState, FormData>(rateOnDevice, {});
  const [score, setScore] = useState<number | null>(defaultScore);
  return (
    <form action={action} className="flex flex-col gap-6">
      <input type="hidden" name="reservationId" value={reservationId} />
      <input type="hidden" name="stage" value={stage} />
      <StarRating size="lg" defaultScore={defaultScore} defaultComment={defaultComment} onChange={setScore} />
      <div className="flex items-center gap-5">
        <Button type="submit" variant="gold" size="lg" className="min-w-36" disabled={pending || !score}>
          {t("submit")}
        </Button>
        <Link href={`/reservations/${reservationId}`} className="text-sm text-muted hover:text-ink">
          {t("skip")}
        </Link>
      </div>
      {state.error && (
        <p className="text-[13px] text-status-danger" role="alert">
          {r.has(`errors.${state.error}`) ? r(`errors.${state.error}`) : state.error}
        </p>
      )}
    </form>
  );
}
