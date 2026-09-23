"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/Button";
import { StarRating } from "@/features/ratings/StarRating";
import { rateConversation } from "./request-actions";
import type { RequestState } from "./request-types";

type Props = { conversationId: string; name: string; rating: { score: number; comment: string | null } | null };

export function ConversationRating({ conversationId, name, rating }: Props) {
  const t = useTranslations("portal.ratings");
  const r = useTranslations("ratings");
  const [state, action, pending] = useActionState<RequestState, FormData>(rateConversation, {});
  const done = rating ?? (state.ok ? { score: Number(state.score ?? 0), comment: null } : null);
  if (done) {
    return (
      <div className="flex flex-col gap-2">
        <p className="text-[13px] font-semibold">{r("thanks")}</p>
        {done.score > 0 && <StarRating defaultScore={done.score} readOnly />}
        {done.comment && <p className="text-[13px] text-charcoal">{done.comment}</p>}
      </div>
    );
  }
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="conversationId" value={conversationId} />
      <p className="text-[14px] font-semibold">{t("rate", { name })}</p>
      <StarRating size="lg" />
      <div>
        <Button type="submit" variant="gold" size="sm" disabled={pending}>
          {r("submit")}
        </Button>
      </div>
      {state.error && <p className="text-[13px] text-status-danger">{t("error")}</p>}
    </form>
  );
}
