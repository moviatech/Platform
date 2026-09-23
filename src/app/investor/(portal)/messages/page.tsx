import type { Metadata } from "next";
import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { NewMessageForm } from "@/features/investor/MessageForms";
import { listInvestorConversations } from "@/features/investor/messages";
import { listInvestorNotifications, renderParams } from "@/features/notifications/center";
import { Icon } from "@/features/portal/icons";
import { loadPortalContent } from "@/features/portal/content";
import { ContactCard, PageIntro } from "@/features/portal/ui";
import { requireInvestor } from "@/lib/auth/investor";
import { rootDomain } from "@/lib/env";
import { cn } from "@/lib/utils/cn";

export const metadata: Metadata = { title: "Messages" };

type Props = { searchParams: Promise<{ status?: string; topic?: string }> };

const zone = "America/Los_Angeles";

export default async function InvestorMessagesPage({ searchParams }: Props) {
  const session = await requireInvestor();
  const { status, topic } = await searchParams;
  const [t, kinds, locale, conversations, notifications, content] = await Promise.all([getTranslations("investor.messages"), getTranslations("investor.notifications.kinds"), getLocale(), listInvestorConversations(session.investorId), listInvestorNotifications(session.investorId, 60), loadPortalContent()]);
  const showNotifications = status === "notifications";
  const unreadNotifications = notifications.filter((item) => !item.read_at).length;
  const unreadConversations = conversations.filter((item) => item.customer_unread).length;
  const short = (value: string) => new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en-US", { timeZone: zone, month: "short", day: "numeric" }).format(new Date(value));
  return (
    <>
      <PageIntro title={t("title")} subtitle={t("subtitle")} />
      <div className="grid gap-4 lg:grid-cols-[18rem_minmax(0,1fr)] xl:grid-cols-[18rem_minmax(0,40rem)_17rem]">
        <section className="card overflow-hidden">
          <div className="flex gap-1 border-b border-ink/[0.06] p-3 text-[12px]">
            <Link href="/messages" className={cn("relative rounded-pill px-2.5 py-1 font-medium", !showNotifications ? "bg-gold/12 text-ink" : "text-muted hover:text-ink")}>
              {t("conversations")}
              {unreadConversations > 0 && <span className="absolute top-0.5 right-0.5 size-1.5 rounded-full bg-gold" />}
            </Link>
            <Link href="/messages?status=notifications" className={cn("relative rounded-pill px-2.5 py-1 font-medium", showNotifications ? "bg-gold/12 text-ink" : "text-muted hover:text-ink")}>
              {t("notifications")}
              {unreadNotifications > 0 && <span className="absolute top-0.5 right-0.5 size-1.5 rounded-full bg-gold" />}
            </Link>
            {(unreadNotifications > 0 || unreadConversations > 0) && (
              <form action="/notifications/read-all" method="post" className="ml-auto">
                <button type="submit" className="rounded-pill px-2.5 py-1 text-muted hover:text-ink">
                  {t("readAll")}
                </button>
              </form>
            )}
          </div>
          {showNotifications ? (
            notifications.length === 0 ? (
              <p className="px-4 py-6 text-[13px] text-muted">{t("noNotifications")}</p>
            ) : (
              <ul className="max-h-[60dvh] divide-y divide-ink/[0.06] overflow-y-auto">
                {notifications.map((item) => (
                  <li key={item.id}>
                    <Link href={`/notifications/${item.id}`} className="flex gap-3 px-4 py-3.5 hover:bg-pearl/70">
                      <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-pearl text-charcoal">
                        <Icon name="bell" size={15} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className={cn("block text-[13px] leading-snug", !item.read_at ? "font-semibold" : "text-charcoal")}>{kinds.has(item.kind) ? kinds(item.kind, renderParams(item.params, locale)) : item.kind}</span>
                        <span className="block text-[11px] text-muted">{short(item.created_at)}</span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )
          ) : conversations.length === 0 ? (
            <p className="px-4 py-6 text-[13px] text-muted">{t("empty")}</p>
          ) : (
            <ul className="max-h-[60dvh] divide-y divide-ink/[0.06] overflow-y-auto">
              {conversations.map((item) => (
                <li key={item.id}>
                  <Link href={`/messages/${item.id}`} className="flex gap-3 px-4 py-3.5 hover:bg-pearl/70">
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-gold text-[13px] font-semibold text-white">M</span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center justify-between gap-2">
                        <span className="truncate text-[13px] font-semibold">{item.subject ?? t("noSubject")}</span>
                        <span className="shrink-0 text-[11px] text-muted">{short(item.last_message_at)}</span>
                      </span>
                      <span className="mt-0.5 flex items-center gap-2">
                        <span className="min-w-0 flex-1 truncate text-[12px] text-muted">{item.last_message_preview ?? ""}</span>
                        {item.customer_unread && <span className="size-2 shrink-0 rounded-full bg-gold" />}
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="card flex min-h-[24rem] flex-col">
          <header className="flex items-center gap-3 border-b border-ink/[0.06] px-5 py-4">
            <span className="flex size-11 items-center justify-center rounded-full bg-gold text-[15px] font-semibold text-white">M</span>
            <span className="min-w-0">
              <span className="block text-[15px] font-semibold">{t("supportName")}</span>
              <span className="block text-[12px] text-muted">contact@{rootDomain}</span>
            </span>
          </header>
          <div className="p-5 sm:p-6">
            <h2 className="mb-4 text-[15px] font-semibold">{t("newTitle")}</h2>
            <NewMessageForm defaultTopic={topic} />
          </div>
        </section>
        <aside className="lg:col-start-2 xl:col-start-auto">
          <ContactCard contact={content.contact} locale={locale} labels={{ title: t("contact.title"), phone: t("contact.phone"), wechat: t("contact.wechat"), email: t("contact.email"), hours: t("contact.hours") }} />
        </aside>
      </div>
    </>
  );
}
