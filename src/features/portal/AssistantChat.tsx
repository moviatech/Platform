"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Field";
import { cn } from "@/lib/utils/cn";

type Action = { type: "link"; label: string; href: string } | { type: "tel" | "mail" | "wechat"; label: string; value: string };
type Table = { title?: string; rows: string[][] };
type Message = { id: string; role: "user" | "bot" | "agent" | "notice"; text: string; tables?: Table[]; note?: string; actions?: Action[]; agentName?: string; createdAt: string };
type Snapshot = { id: string; status: "bot" | "waiting" | "agent"; messages: Message[]; suggestions?: Array<{ id: string; question: string }>; error?: string; handoffConversationId?: string };

const storageKey = "movia_chat";

async function call(path: string, init?: RequestInit): Promise<Snapshot | null> {
  try {
    const response = await fetch(path, { ...init, headers: { "content-type": "application/json", ...(init?.headers ?? {}) } });
    if (!response.ok) return null;
    return (await response.json()) as Snapshot;
  } catch {
    return null;
  }
}

export function AssistantChat({ locale, tall }: { locale: "zh" | "en"; tall?: boolean }) {
  const t = useTranslations("portal.help");
  const [id, setId] = useState<string | null>(null);
  const [status, setStatus] = useState<Snapshot["status"]>("bot");
  const [messages, setMessages] = useState<Message[]>([]);
  const [suggestions, setSuggestions] = useState<Array<{ id: string; question: string }>>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [offline, setOffline] = useState(false);
  const [handoff, setHandoff] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const apply = useCallback((snapshot: Snapshot | null, append: boolean) => {
    if (!snapshot) {
      setOffline(true);
      return;
    }
    setOffline(false);
    setId(snapshot.id);
    setStatus(snapshot.status);
    setMessages((current) => {
      const incoming = snapshot.messages ?? [];
      if (!append) return incoming;
      const known = new Set(current.map((message) => message.id));
      return [...current, ...incoming.filter((message) => !known.has(message.id))];
    });
    if (snapshot.suggestions) setSuggestions(snapshot.suggestions);
    try {
      sessionStorage.setItem(storageKey, snapshot.id);
    } catch {}
  }, []);

  useEffect(() => {
    let stored: string | null = null;
    try {
      stored = sessionStorage.getItem(storageKey);
    } catch {}
    (async () => {
      const snapshot = stored ? await call(`/assistant?id=${encodeURIComponent(stored)}`) : null;
      if (snapshot) apply(snapshot, false);
      else apply(await call("/assistant", { method: "POST", body: JSON.stringify({ locale }) }), false);
    })();
  }, [apply, locale]);

  useEffect(() => {
    if (!id || status === "bot") return;
    const timer = setInterval(async () => {
      const last = messages[messages.length - 1]?.id;
      const snapshot = await call(`/assistant?id=${encodeURIComponent(id)}${last ? `&after=${encodeURIComponent(last)}` : ""}`);
      if (snapshot) apply(snapshot, true);
    }, 6000);
    return () => clearInterval(timer);
  }, [id, status, messages, apply]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  async function send(value: string, entryId?: string) {
    const trimmed = value.trim();
    if ((!trimmed && !entryId) || busy) return;
    setBusy(true);
    setText("");
    setSuggestions([]);
    const snapshot = await call("/assistant", { method: "POST", body: JSON.stringify({ conversationId: id, locale, text: entryId ? "" : trimmed, entryId }) });
    apply(snapshot, true);
    if (snapshot?.handoffConversationId) setHandoff(snapshot.handoffConversationId);
    setBusy(false);
  }

  const statusLabel = status === "agent" ? t("chatAgent") : status === "waiting" ? t("chatWaiting") : t("chatBot");

  return (
    <div className={cn("flex flex-col", tall ? "h-full" : "h-[36rem] max-h-[75dvh]")}>
      <div className="flex items-center justify-between border-b border-ink/[0.07] px-5 py-3.5">
        <p className="text-sm font-semibold">{t("chatTitle")}</p>
        <span className={cn("rounded-pill px-2.5 py-1 text-[11px] font-medium", status === "bot" ? "bg-ink/5 text-charcoal" : "bg-status-available/12 text-status-available")}>{statusLabel}</span>
      </div>
      <div ref={listRef} className="flex-1 overflow-y-auto px-5 py-4">
        {offline && messages.length === 0 && <p className="text-[13px] text-muted">{t("chatOffline")}</p>}
        <ol className="flex flex-col gap-3">
          {messages.map((message) => (
            <li key={message.id} className={cn("flex", message.role === "user" ? "justify-end" : "justify-start")}>
              <div className={cn("max-w-[85%] rounded-xl px-4 py-2.5 text-[14px] leading-relaxed", message.role === "user" ? "bg-ink text-white" : message.role === "notice" ? "bg-pearl text-muted" : "bg-pearl text-ink")}>
                {message.role === "agent" && <p className="mb-0.5 text-[11px] font-semibold tracking-wide text-gold uppercase">{message.agentName ?? "Movia"}</p>}
                <p className="whitespace-pre-wrap">{message.text}</p>
                {message.tables?.map((table, index) => (
                  <table key={index} className="mt-2 w-full text-[12px]">
                    {table.title && <caption className="mb-1 text-left font-medium">{table.title}</caption>}
                    <tbody>
                      {table.rows.map((row, r) => (
                        <tr key={r} className="border-t border-ink/[0.08]">
                          {row.map((cell, c) => (
                            <td key={c} className="py-1 pr-3 align-top">
                              {cell}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ))}
                {message.note && <p className="mt-1.5 text-[12px] text-muted">{message.note}</p>}
                {message.actions && message.actions.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {message.actions.map((item, index) => {
                      const href = item.type === "link" ? item.href : item.type === "tel" ? `tel:${item.value}` : item.type === "mail" ? `mailto:${item.value}` : undefined;
                      const className = "rounded-pill bg-white px-3 py-1 text-[12px] font-medium text-ink hairline";
                      return href ? (
                        <a key={index} href={href} target={item.type === "link" ? "_blank" : undefined} rel="noreferrer" className={className}>
                          {item.label}
                        </a>
                      ) : (
                        <span key={index} className={className}>
                          {item.label}: {item.type === "wechat" ? item.value : ""}
                        </span>
                      );
                    })}
                  </div>
                )}
              </div>
            </li>
          ))}
        </ol>
        {handoff && (
          <a href={`/messages/${handoff}`} className="mt-4 flex items-center justify-between gap-3 rounded-xl bg-gold/10 px-4 py-3 text-[13px] text-ink hover:bg-gold/15">
            <span>{t("handoffNotice")}</span>
            <span className="shrink-0 font-semibold text-gold">{t("openMessages")} →</span>
          </a>
        )}
        {suggestions.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-2">
            {suggestions.map((item) => (
              <button key={item.id} type="button" onClick={() => send(item.question, item.id)} className="rounded-pill bg-white px-3.5 py-1.5 text-[13px] text-charcoal hairline hover:border-ink/25">
                {item.question}
              </button>
            ))}
          </div>
        )}
      </div>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          send(text);
        }}
        className="flex items-center gap-2 border-t border-ink/[0.07] px-4 py-3"
      >
        <Input value={text} onChange={(event) => setText(event.target.value)} placeholder={t("chatPlaceholder")} maxLength={1000} className="h-10" />
        <Button type="submit" size="sm" variant="gold" disabled={busy || !text.trim()} className="shrink-0">
          {t("chatSend")}
        </Button>
        {status === "bot" && (
          <Button type="button" size="sm" variant="secondary" disabled={busy || !id} onClick={() => send(locale === "zh" ? "转人工" : "talk to a human")} className="shrink-0">
            {t("chatHuman")}
          </Button>
        )}
      </form>
    </div>
  );
}
