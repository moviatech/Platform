import { cn } from "@/lib/utils/cn";
import { Icon } from "./icons";
import type { RequestMessage } from "./request-queries";

const zone = "America/Los_Angeles";

export function threadFormat(locale: string, today: string) {
  const tag = locale === "zh" ? "zh-CN" : "en-US";
  const dayOf = (value: string) => new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(value));
  const now = dayOf(new Date().toISOString());
  return {
    dayOf,
    dayLabel: (value: string) => (dayOf(value) === now ? today : new Intl.DateTimeFormat(tag, { timeZone: zone, month: "long", day: "numeric" }).format(new Date(value))),
    timeOf: (value: string) => new Intl.DateTimeFormat(tag, { timeZone: zone, hour: "numeric", minute: "2-digit" }).format(new Date(value)),
  };
}

type Props = { message: RequestMessage; divider: string | null; time: string; initial: string };

export function MessageBubble({ message, divider, time, initial }: Props) {
  const mine = message.direction === "INBOUND";
  return (
    <li className="flex flex-col gap-4">
      {divider && <p className="text-center text-[11px] text-muted">{divider}</p>}
      <div className={cn("flex items-end gap-2.5", mine ? "justify-end" : "justify-start")}>
        {!mine && <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-gold text-[12px] font-semibold text-white">M</span>}
        <div className="max-w-[78%]">
          <div className={cn("rounded-xl px-4 py-3 text-[14px] leading-relaxed", mine ? "rounded-br-md bg-gold/12 text-ink" : "rounded-bl-md bg-pearl text-ink")}>
            {!mine && message.from_name && message.from_name !== "Movia" && <p className="mb-1 text-[11px] font-semibold tracking-wide text-gold uppercase">{message.from_name}</p>}
            <p className="whitespace-pre-wrap">{message.body_text}</p>
            {message.attachments.length > 0 && (
              <ul className="mt-2 flex flex-wrap gap-1.5">
                {message.attachments.map((file) => (
                  <li key={file.id}>
                    <a href={`/attachments/${file.id}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-pill bg-white px-2.5 py-1 text-[12px] text-ink hairline">
                      <Icon name={file.mime_type.startsWith("video/") ? "play" : "image"} size={12} />
                      {file.filename}
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <p className={cn("mt-1 text-[11px] text-muted", mine && "text-right")}>{time}</p>
        </div>
        {mine && <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-ink text-[12px] font-semibold text-white">{initial}</span>}
      </div>
    </li>
  );
}
