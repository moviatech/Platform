import { getLocale, getTranslations } from "next-intl/server";
import { formatFullDateTime } from "@/lib/utils/format";
import { cn } from "@/lib/utils/cn";
import { splitQuoted } from "./text";
import type { Message } from "./types";

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export async function Thread({ messages, chat }: { messages: Message[]; chat?: boolean }) {
  const t = await getTranslations("inbox");
  const locale = await getLocale();

  if (messages.length === 0) {
    return <p className="px-6 py-12 text-center text-[13px] text-muted">{t("emptyThread")}</p>;
  }

  return (
    <ol className="flex flex-col gap-4 px-4 py-5 sm:px-6">
      {messages.map((message) => {
        const { body, quoted } = splitQuoted(message.body_text);
        const outbound = message.direction === "OUTBOUND";
        const note = message.direction === "INTERNAL";
        const failed = message.delivery_status === "FAILED" || message.delivery_status === "BOUNCED" || message.delivery_status === "COMPLAINED";
        return (
          <li key={message.id} className={cn("flex flex-col", outbound ? "items-end" : "items-start", note && "items-stretch")}>
            <div
              className={cn(
                "max-w-[44rem] rounded-2xl px-4 py-3 text-sm",
                note
                  ? "max-w-none border border-dashed border-status-limited/50 bg-status-limited/[0.07]"
                  : outbound
                    ? "bg-ink text-white"
                    : "border border-ink/[0.08] bg-white",
                failed && "border border-status-danger/50 bg-status-danger/[0.06] text-ink",
              )}
            >
              <p className={cn("mb-1.5 text-[11px] tracking-wide", outbound && !failed ? "text-white/60" : "text-muted")}>
                {note ? `${t("note")} · ${message.from_name ?? ""}` : outbound ? [message.from_name, message.from_email].filter(Boolean).join(" · ") : message.from_name || message.from_email}
                {message.channel === "WEB_FORM" ? ` · ${chat ? t("chat") : t("webForm")}` : message.channel === "PORTAL" ? ` · ${chat ? t("chat") : t("portal")}` : ""}
              </p>
              <p className="break-words whitespace-pre-wrap">{body || quoted}</p>
              {body && quoted && (
                <details className={cn("mt-2 text-xs", outbound && !failed ? "text-white/60" : "text-muted")}>
                  <summary>{t("showQuoted")}</summary>
                  <p className="mt-2 break-words whitespace-pre-wrap">{quoted}</p>
                </details>
              )}
              {message.attachments.length > 0 && (
                <ul className="mt-3 flex flex-wrap gap-2">
                  {message.attachments.map((file) => (
                    <li key={file.id}>
                      <a
                        href={`/inbox/attachments/${file.id}`}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex max-w-[16rem] items-center gap-2 rounded-xl border border-ink/10 bg-pearl/70 px-3 py-1.5 text-xs text-ink hover:border-gold/50"
                      >
                        <span className="truncate">{file.filename}</span>
                        <span className="shrink-0 text-muted">{formatSize(file.size_bytes)}</span>
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <p className={cn("mt-1 px-1 text-[11px]", failed ? "text-status-danger" : "text-muted")}>
              {formatFullDateTime(message.created_at, locale)}
              {outbound ? ` · ${t(`delivery.${message.delivery_status}`)}` : ""}
            </p>
          </li>
        );
      })}
    </ol>
  );
}
