import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { formatDate, formatDateTime } from "@/lib/utils/format";
import { ConversationRows } from "./ConversationRows";
import { cn } from "@/lib/utils/cn";
import type { InboxFilters } from "./queries";
import { conversationStatuses, replyChannelFor, type Conversation } from "./types";

type Props = {
  conversations: Conversation[];
  filters: InboxFilters;
  activeId?: string;
  staff: Array<{ user_id: string; display_name: string }>;
  canManage: boolean;
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

export async function ConversationList({ conversations, filters, activeId, staff, canManage }: Props) {
  const [t, common, locale] = await Promise.all([getTranslations("inbox"), getTranslations("common"), getLocale()]);
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
        <ConversationRows
          rows={conversations.map((item) => {
            const channel = replyChannelFor(item);
            const payload = item.lead?.payload ?? {};
            const source = channel === "CHAT" ? t("chat") : channel === "PORTAL" ? t("portal") : item.lead?.kind === "CONTACT" ? t("webForm") : item.lead?.kind === "BOOKING_REQUEST" ? t("bookingRequest") : t("email");
            const dates = item.reservation?.pickup_at && item.reservation?.return_at ? `${formatDate(item.reservation.pickup_at)} → ${formatDate(item.reservation.return_at)}` : typeof payload.pickupDate === "string" && typeof payload.returnDate === "string" ? `${payload.pickupDate} → ${payload.returnDate}` : null;
            const vehicle = item.reservation?.vehicle_class ? (locale === "zh" ? (item.reservation.vehicle_class.name_zh ?? item.reservation.vehicle_class.name) : item.reservation.vehicle_class.name) : typeof payload.vehicleSlug === "string" ? payload.vehicleSlug : null;
            const ai = item.ai_summary;
            return {
              id: item.id,
              href: `/inbox/${item.id}${queryString(filters)}`,
              title: item.customer_name || item.customer_email || t("visitor"),
              subject: (locale === "zh" ? ai?.title_zh : ai?.title_en) || item.subject || t("noSubject"),
              meta: [source, item.reservation?.number ?? null, dates, vehicle].filter(Boolean).join(" · "),
              preview: `${item.last_direction === "OUTBOUND" ? `${t("you")} · ` : ""}${(locale === "zh" ? ai?.summary_zh : ai?.summary_en) || item.last_message_preview || ""}`,
              time: formatDateTime(item.last_message_at),
              unread: item.unread,
              active: item.id === activeId,
            };
          })}
          labels={{ select: t("bulk.select"), cancel: t("bulk.cancel"), selectAll: t("bulk.selectAll"), selected: t("bulk.selected"), status: t("bulk.status"), assign: t("bulk.assign"), unassigned: t("panel.unassigned"), apply: t("bulk.apply"), applying: t("sending") }}
          statuses={conversationStatuses.map((status) => ({ value: status, label: t(`status.${status}`) }))}
          staff={staff}
          canManage={canManage}
        />
      )}
    </div>
  );
}
