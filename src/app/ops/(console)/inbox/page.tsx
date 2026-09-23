import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/ops/PageHeader";
import { ButtonLink } from "@/components/ui/Button";
import { ConversationList } from "@/features/inbox/ConversationList";
import { InboxTabs } from "@/features/inbox/InboxTabs";
import { listConversations, type InboxFilters } from "@/features/inbox/queries";
import { countUnreadStaff, listStaffNotifications } from "@/features/notifications/center";
import { NotificationList } from "@/features/notifications/NotificationList";
import { can, requirePagePermission } from "@/lib/auth/staff";

export const metadata: Metadata = { title: "Inbox" };

type Props = { searchParams: Promise<InboxFilters & { view?: string }> };

export default async function InboxPage({ searchParams }: Props) {
  const session = await requirePagePermission("inbox.view");
  const { view, ...filters } = await searchParams;
  const t = await getTranslations("inbox");
  const notifications = view === "notifications";

  const [conversations, notificationRows, unreadNotifications] = await Promise.all([
    notifications ? Promise.resolve([]) : listConversations(filters, session.userId),
    notifications ? listStaffNotifications() : Promise.resolve([]),
    countUnreadStaff(),
  ]);

  return (
    <>
      <PageHeader
        title={t("title")}
        actions={
          notifications ? (
            unreadNotifications > 0 ? (
              <form action="/inbox/notifications/read-all" method="post">
                <button type="submit" className="rounded-pill px-3 py-1.5 text-[13px] text-charcoal hairline hover:border-ink/25">
                  {t("tabs.readAll")}
                </button>
              </form>
            ) : undefined
          ) : (
            <div className="flex items-center gap-2">
              {conversations.some((item) => item.unread) && (
                <form action="/inbox/read-all" method="post">
                  <button type="submit" className="rounded-pill px-3 py-1.5 text-[13px] text-charcoal hairline hover:border-ink/25">
                    {t("tabs.readAll")}
                  </button>
                </form>
              )}
              {can(session, "inbox.reply") && (
                <ButtonLink href="/inbox/new" size="sm">
                  {t("outreach.new")}
                </ButtonLink>
              )}
            </div>
          )
        }
      />
      <InboxTabs active={notifications ? "notifications" : "conversations"} notificationCount={unreadNotifications} />
      {notifications ? (
        <NotificationList items={notificationRows} />
      ) : (
        <div className="grid gap-5 lg:h-[calc(100dvh-14rem)] lg:grid-cols-[20rem_minmax(0,1fr)]">
          <ConversationList conversations={conversations} filters={filters} />
          <div className="card hidden items-center justify-center text-[13px] text-muted lg:flex">{t("pick")}</div>
        </div>
      )}
    </>
  );
}
