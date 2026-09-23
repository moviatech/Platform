"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { MessageBubble, threadFormat } from "./MessageBubble";
import type { RequestMessage } from "./request-queries";

type Props = { conversationId: string; lastMessageId: string; lastMessageAt: string | null; locale: string; customerInitial: string };
type Payload = { status: string; ended: boolean; messages: RequestMessage[] };

let audio: AudioContext | null = null;
let armed = false;
let pending = 0;
let baseTitle: string | null = null;

function arm() {
  if (armed) return;
  armed = true;
  const create = () => {
    try {
      audio ??= new AudioContext();
    } catch {}
  };
  window.addEventListener("pointerdown", create, { once: true });
  window.addEventListener("keydown", create, { once: true });
}

function chime() {
  const ctx = audio;
  if (!ctx) return;
  const play = () => {
    const start = ctx.currentTime;
    [
      [880, 0],
      [1175, 0.12],
    ].forEach(([frequency, offset]) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, start + offset);
      gain.gain.exponentialRampToValueAtTime(0.06, start + offset + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + offset + 0.13);
      osc.connect(gain).connect(ctx.destination);
      osc.start(start + offset);
      osc.stop(start + offset + 0.14);
    });
  };
  if (ctx.state === "suspended") ctx.resume().then(play).catch(() => undefined);
  else play();
}

function badge() {
  if (document.visibilityState === "visible") return;
  pending += 1;
  baseTitle ??= document.title;
  document.title = `(${pending}) ${baseTitle}`;
}

function clearBadge() {
  if (baseTitle === null) return;
  document.title = baseTitle;
  baseTitle = null;
  pending = 0;
}

export function LiveThread({ conversationId, lastMessageId, lastMessageAt, locale, customerInitial }: Props) {
  const router = useRouter();
  const t = useTranslations("portal.messages");
  const [items, setItems] = useState<RequestMessage[]>([]);
  const cursor = useRef(lastMessageId);
  const format = threadFormat(locale, t("today"));

  useEffect(() => {
    arm();
    let active = true;
    let inflight = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      if (active) timer = setTimeout(poll, document.visibilityState === "visible" ? 4000 : 15000);
    };
    const poll = async () => {
      timer = undefined;
      if (inflight) return;
      inflight = true;
      let stop = false;
      try {
        const response = await fetch(`/messages/${conversationId}/poll?after=${cursor.current}`, { cache: "no-store" });
        if (response.status === 401) stop = true;
        else if (response.ok) {
          const payload = (await response.json()) as Payload;
          if (payload.messages.length) {
            cursor.current = payload.messages[payload.messages.length - 1].id;
            setItems((current) => [...current, ...payload.messages]);
            if (payload.messages.some((message) => message.direction === "OUTBOUND")) {
              chime();
              badge();
              router.refresh();
            }
          }
          if (payload.ended) {
            stop = true;
            router.refresh();
          }
        }
      } catch {}
      inflight = false;
      if (stop) active = false;
      else schedule();
    };
    const onVisibility = () => {
      if (document.visibilityState !== "visible") return;
      clearBadge();
      if (timer) {
        clearTimeout(timer);
        poll();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    schedule();
    return () => {
      active = false;
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [conversationId, router]);

  return (
    <>
      {items.map((message, index) => {
        const previous = index === 0 ? lastMessageAt : items[index - 1].created_at;
        const divider = !previous || format.dayOf(previous) !== format.dayOf(message.created_at) ? format.dayLabel(message.created_at) : null;
        return <MessageBubble key={message.id} message={message} divider={divider} time={format.timeOf(message.created_at)} initial={customerInitial} />;
      })}
    </>
  );
}
