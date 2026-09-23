import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { formatDateTime } from "@/lib/utils/format";
import { cn } from "@/lib/utils/cn";
import type { InboxFilters } from "./queries";
import { replyChannelFor, type Conversation } from "./types";

type Props = {
  conversations: Conversation[];
  filters: InboxFilters;
  activeId?: string;
};

function queryString(filters: InboxFilters, patch: Partial<InboxFilters> = {}) {
  const params = new URLSearchParams();
  const merged = { ...filters, ...patch };
  if (merged.status && merged.status !== "OPEN") params.set("status", merged.status);
  if (merged.mine === "1") params.set("mine", "1");
  if (merged.q) params.set("q", merged.q);
  const value = params.toString();
  return value ? `?${value}` : "";
}

export async function ConversationList({ conversations, filters, activeId }: Props) {
  const t = await getTranslations("inbox");
  const common = await getTranslations("common");
  const locale = await getLocale();
  const current = filters.status ?? "OPEN";

  const tabs = [
    { key: "OPEN", label: t("status.OPEN") },
    { key: "PENDING_CUSTOMER", label: t("status.PENDING_CUSTOMER") },
    { key: "RESOLVED", label: t("status.RESOLVED") },
    { key: "SPAM", label: t("status.SPAM") },
    { key: "all", label: common("all") },
  ];

  return (
    <div className="card flex min-h-0 flex-col overflow-hidden">
      <div className="border-b border-ink/[0.07] p-3">
        <form action="/inbox" className="flex gap-2">
          {current !== "OPEN" && <input type="hidden" name="status" value={current} />}
          {filters.mine === "1" && <input type="hidden" name="mine" value="1" />}
          <input
            type="search"
            name="q"
            defaultValue={filters.q ?? ""}
            placeholder={t("search")}
            className="h-9 w-full rounded-xl border border-ink/10 bg-white px-3 text-[13px] placeholder:text-muted/70 focus:border-gold/60 focus:outline-none focus:ring-4 focus:ring-gold/10"
          />
        </form>
        <div className="no-scrollbar mt-2.5 flex gap-1 overflow-x-auto">
          {tabs.map((tab) => (
            <Link
              key={tab.key}
              href={`/inbox${queryString(filters, { status: tab.key })}`}
              className={cn(
                "shrink-0 rounded-pill px-2.5 py-1 text-xs transition-colors",
                current === tab.key ? "bg-ink text-white" : "text-charcoal hover:bg-ink/5",
              )}
            >
              {tab.label}
            </Link>
          ))}
          <Link
            href={`/inbox${queryString(filters, { mine: filters.mine === "1" ? undefined : "1" })}`}
            className={cn(
              "ml-auto shrink-0 rounded-pill px-2.5 py-1 text-xs transition-colors",
              filters.mine === "1" ? "bg-gold text-white" : "text-charcoal hover:bg-ink/5",
            )}
          >
            {t("mine")}
          </Link>
        </div>
      </div>
      {conversations.length === 0 ? (
        <p className="px-5 py-12 text-center text-[13px] text-muted">{t("emptyList")}</p>
      ) : (
        <ul className="min-h-0 flex-1 divide-y divide-ink/[0.06] overflow-y-auto">
          {conversations.map((item) => {
            const channel = replyChannelFor(item);
            return (
            <li key={item.id}>
              <Link
                href={`/inbox/${item.id}${queryString(filters)}`}
                aria-current={item.id === activeId ? "page" : undefined}
                className={cn(
                  "relative block px-4 py-3 transition-colors",
                  item.id === activeId ? "bg-gold/[0.07]" : "hover:bg-ink/[0.025]",
                )}
              >
                {item.unread && <span aria-hidden="true" className="absolute left-1.5 top-[1.15rem] size-1.5 rounded-full bg-gold" />}
                <div className="flex items-baseline justify-between gap-3">
                  <span className={cn("truncate text-sm", item.unread ? "font-semibold" : "font-medium")}>
                    {item.customer_name || item.customer_email || t("visitor")}
                  </span>
                  <span className="shrink-0 text-[11px] text-muted">{formatDateTime(item.last_message_at, locale)}</span>
                </div>
                <p className={cn("mt-0.5 truncate text-[13px]", item.unread ? "text-ink" : "text-charcoal")}>{item.subject || t("noSubject")}</p>
                <p className="mt-0.5 truncate text-xs text-muted">
                  {item.last_direction === "OUTBOUND" ? `${t("you")} · ` : ""}
                  {item.last_message_preview ?? ""}
                </p>
                <p className="mt-1.5 text-[10px] tracking-[0.12em] text-muted/80 uppercase">
                  {channel === "PORTAL" ? t("portal") : channel === "CHAT" ? t("chat") : `${item.mailbox}@`}
                </p>
              </Link>
            </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
