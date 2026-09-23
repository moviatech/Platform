"use client";

import { useActionState, useEffect, useRef, useState, useTransition, type PointerEvent } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/utils/cn";
import { compose, polishReply, type ComposeState } from "./actions";
import { personas } from "./personas";
import type { ReplyChannel } from "./types";

type Props = {
  conversationId: string;
  canReply: boolean;
  channel: ReplyChannel;
  emailAvailable?: boolean;
  defaultLanguage: "zh" | "en";
  ai: boolean;
};

const replyLabel: Record<ReplyChannel, string> = { PORTAL: "replyPortal", CHAT: "replyChat", EMAIL: "reply" };
const heightKey = "movia-lori-reply-height";
const minHeight = 64;

function storedHeight() {
  try {
    const value = Number(localStorage.getItem(heightKey));
    if (value >= minHeight) return value;
  } catch {}
  return 140;
}

function Draft({ conversationId, defaultLanguage, ai, pending, persona }: { conversationId: string; defaultLanguage: "zh" | "en"; ai: boolean; pending: boolean; persona: string }) {
  const t = useTranslations("inbox");
  const [body, setBody] = useState("");
  const [language, setLanguage] = useState(defaultLanguage);
  const [height, setHeight] = useState(140);
  const [previous, setPrevious] = useState<string | null>(null);
  const [last, setLast] = useState<{ mode: "polish" | "draft"; draft: string } | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  const [polishing, startPolish] = useTransition();
  const drag = useRef<{ y: number; height: number } | null>(null);
  const latest = useRef(height);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setHeight(storedHeight()));
    return () => cancelAnimationFrame(frame);
  }, []);

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    drag.current = { y: event.clientY, height };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    latest.current = Math.min(Math.max(minHeight, drag.current.height + drag.current.y - event.clientY), Math.round(window.innerHeight * 0.7));
    setHeight(latest.current);
  };
  const onPointerUp = () => {
    if (!drag.current) return;
    drag.current = null;
    try {
      localStorage.setItem(heightKey, String(latest.current));
    } catch {}
  };
  const run = (mode: "polish" | "draft", draft: string) => {
    const form = new FormData();
    form.set("conversationId", conversationId);
    form.set("draft", draft);
    form.set("language", language);
    form.set("persona", persona);
    form.set("mode", mode);
    setAiError(null);
    const current = body;
    startPolish(async () => {
      const response = await polishReply(form);
      if (response.text) {
        setPrevious((value) => value ?? current);
        setLast({ mode, draft });
        setBody(response.text);
      } else setAiError(response.error ?? "failed");
    });
  };
  const polish = (mode: "polish" | "draft") => {
    if (mode === "polish" && !body.trim()) return;
    run(mode, mode === "polish" ? body : "");
  };
  const undo = () => {
    if (previous === null) return;
    setBody(previous);
    setPrevious(null);
    setLast(null);
  };

  return (
    <>
      <div
        role="separator"
        aria-orientation="horizontal"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        className="flex h-4 cursor-row-resize touch-none items-center justify-center select-none"
      >
        <span className="h-1 w-10 rounded-full bg-ink/15" aria-hidden="true" />
      </div>
      <textarea
        name="body"
        required
        maxLength={20000}
        value={body}
        onChange={(event) => setBody(event.target.value)}
        style={{ height }}
        placeholder={t("replyPlaceholder")}
        className="w-full resize-none rounded-xl border border-ink/10 bg-white px-3.5 py-2.5 text-sm placeholder:text-muted/70 focus:border-gold/60 focus:ring-4 focus:ring-gold/10 focus:outline-none"
      />
      {ai && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
          <span className="flex overflow-hidden rounded-pill border border-ink/10">
            {(["zh", "en"] as const).map((item) => (
              <button key={item} type="button" onClick={() => setLanguage(item)} className={cn("px-2.5 py-1", language === item ? "bg-ink text-white" : "text-charcoal hover:bg-ink/5")}>
                {t(`ai.${item}`)}
              </button>
            ))}
          </span>
          <button type="button" onClick={() => polish("draft")} disabled={polishing || pending} className="rounded-pill border border-gold/60 px-3 py-1 font-medium text-gold hover:bg-gold/10 disabled:opacity-40">
            {polishing ? t("ai.polishing") : t("ai.draft")}
          </button>
          <button type="button" onClick={() => polish("polish")} disabled={polishing || pending || !body.trim()} className="rounded-pill border border-gold/60 px-3 py-1 font-medium text-gold hover:bg-gold/10 disabled:opacity-40">
            {polishing ? t("ai.polishing") : t("ai.polish")}
          </button>
          {last && (
            <>
              <button type="button" onClick={() => run(last.mode, last.draft)} disabled={polishing || pending} className="text-charcoal underline decoration-gold/50 underline-offset-2 hover:text-ink disabled:opacity-40">
                {t("ai.retry")}
              </button>
              <button type="button" onClick={undo} disabled={polishing} className="text-muted underline decoration-gold/50 underline-offset-2 hover:text-ink">
                {t("ai.undo")}
              </button>
            </>
          )}
          {aiError && (
            <span className="text-status-danger" role="alert">
              {t("ai.failed")} · {aiError}
            </span>
          )}
        </div>
      )}
    </>
  );
}

export function Composer({ conversationId, canReply, channel, emailAvailable, defaultLanguage, ai }: Props) {
  const t = useTranslations("inbox");
  const locale = useLocale();
  const [state, action, pending] = useActionState<ComposeState, FormData>(compose, {});
  const [persona, setPersona] = useState("support");
  if (!canReply) return null;

  return (
    <form action={action} className="border-t border-ink/[0.07] bg-white px-4 pb-4 sm:px-6">
      <input type="hidden" name="conversationId" value={conversationId} />
      <input type="hidden" name="mode" value="reply" />
      <Draft key={state.ok ? state.at : "draft"} conversationId={conversationId} defaultLanguage={defaultLanguage} ai={ai} pending={pending} persona={persona} />
      <div className="mt-2.5 flex flex-nowrap items-center gap-1 overflow-x-auto">
        <span className="rounded-pill bg-ink px-3 py-1 text-xs text-white">{t(replyLabel[channel])}</span>
        {channel === "CHAT" && emailAvailable && (
          <label className="ml-2 flex shrink-0 items-center gap-1.5 text-xs text-charcoal">
            <input type="checkbox" name="viaEmail" value="1" className="size-3.5 accent-[#b58b4b]" />
            {t("viaEmail")}
          </label>
        )}
        <select name="persona" value={persona} onChange={(event) => setPersona(event.target.value)} aria-label={t("persona")} className="ml-2 h-7 rounded-pill border border-ink/10 bg-white px-2 text-xs text-charcoal focus:border-gold/60 focus:outline-none">
          {personas.map((item) => (
            <option key={item.id} value={item.id}>
              {locale === "zh" ? item.zh : item.en}
            </option>
          ))}
        </select>
        <Button type="submit" size="sm" variant="primary" disabled={pending} className="ml-auto shrink-0">
          {pending ? t("sending") : t("send")}
        </Button>
        {state.ok && <span className="shrink-0 text-xs text-status-available">{t("done")}</span>}
        {state.error && (
          <span className="shrink-0 text-xs text-status-danger" role="alert">
            {state.error === "send_failed" ? t("sendFailed") : t("invalid")}
          </span>
        )}
      </div>
    </form>
  );
}
