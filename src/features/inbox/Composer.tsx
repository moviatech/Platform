"use client";

import { useActionState, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/utils/cn";
import { compose, type ComposeState } from "./actions";
import { personas } from "./personas";
import type { ReplyChannel } from "./types";

type Props = {
  conversationId: string;
  canReply: boolean;
  channel: ReplyChannel;
};

const replyLabel: Record<ReplyChannel, string> = { PORTAL: "replyPortal", CHAT: "replyChat", EMAIL: "reply" };

export function Composer({ conversationId, canReply, channel }: Props) {
  const t = useTranslations("inbox");
  const locale = useLocale();
  const [mode, setMode] = useState<"reply" | "note">(canReply ? "reply" : "note");
  const [state, action, pending] = useActionState<ComposeState, FormData>(compose, {});

  return (
    <form action={action} className="border-t border-ink/[0.07] bg-white p-4 sm:px-6">
      <input type="hidden" name="conversationId" value={conversationId} />
      <input type="hidden" name="mode" value={mode} />
      <div className="mb-2.5 flex flex-nowrap items-center gap-1 overflow-x-auto">
        {canReply && (
          <button
            type="button"
            onClick={() => setMode("reply")}
            className={cn("rounded-pill px-3 py-1 text-xs", mode === "reply" ? "bg-ink text-white" : "text-charcoal hover:bg-ink/5")}
          >
            {t(replyLabel[channel])}
          </button>
        )}
        <button
          type="button"
          onClick={() => setMode("note")}
          className={cn("rounded-pill px-3 py-1 text-xs", mode === "note" ? "bg-status-limited text-white" : "text-charcoal hover:bg-ink/5")}
        >
          {t("note")}
        </button>
        {mode === "reply" && (
          <select name="persona" defaultValue="support" aria-label={t("persona")} className="ml-2 h-7 rounded-pill border border-ink/10 bg-white px-2 text-xs text-charcoal focus:border-gold/60 focus:outline-none">
            {personas.map((item) => (
              <option key={item.id} value={item.id}>
                {locale === "zh" ? item.zh : item.en}
              </option>
            ))}
          </select>
        )}
      </div>
      <textarea
        key={state.ok ? state.at : "draft"}
        name="body"
        required
        maxLength={20000}
        rows={5}
        placeholder={mode === "reply" ? t("replyPlaceholder") : t("notePlaceholder")}
        className={cn(
          "w-full resize-y rounded-xl border px-3.5 py-2.5 text-sm placeholder:text-muted/70 focus:outline-none focus:ring-4",
          mode === "note"
            ? "border-status-limited/40 bg-status-limited/[0.06] focus:border-status-limited/70 focus:ring-status-limited/10"
            : "border-ink/10 bg-white focus:border-gold/60 focus:ring-gold/10",
        )}
      />
      <div className="mt-2.5 flex items-center gap-3">
        <Button type="submit" size="sm" variant={mode === "note" ? "secondary" : "primary"} disabled={pending}>
          {pending ? t("sending") : mode === "reply" ? t("send") : t("saveNote")}
        </Button>
        {state.ok && <span className="text-xs text-status-available">{t("done")}</span>}
        {state.error && (
          <span className="text-xs text-status-danger" role="alert">
            {state.error === "send_failed" ? t("sendFailed") : t("invalid")}
          </span>
        )}
      </div>
    </form>
  );
}
