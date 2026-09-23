import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/Badge";
import { conversationStatusTone } from "@/features/inbox/types";
import { ReplyForm } from "@/features/investor/MessageForms";
import { getInvestorConversation, listInvestorConversations } from "@/features/investor/messages";
import { Icon } from "@/features/portal/icons";
import { MessageBubble, threadFormat } from "@/features/portal/MessageBubble";
import { PageIntro } from "@/features/portal/ui";
import { requireInvestor } from "@/lib/auth/investor";
import { createAdminClient } from "@/lib/supabase/admin";
import { cn } from "@/lib/utils/cn";

export const metadata: Metadata = { title: "Message" };

type Props = { params: Promise<{ id: string }> };

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const zone = "America/Los_Angeles";

export default async function InvestorMessagePage({ params }: Props) {
  const session = await requireInvestor();
  const { id } = await params;
  if (!uuid.test(id)) notFound();
  const data = await getInvestorConversation(session.investorId, id);
  if (!data) notFound();
  await createAdminClient().from("conversations").update({ customer_read_at: new Date().toISOString(), customer_unread: false }).eq("id", id).eq("investor_id", session.investorId);
  const [t, statuses, locale, conversations] = await Promise.all([getTranslations("investor.messages"), getTranslations("inbox.status"), getLocale(), listInvestorConversations(session.investorId)]);
  const { dayOf, dayLabel, timeOf } = threadFormat(locale, t("today"));
  const initial = session.legalName.trim().slice(0, 1).toUpperCase();
  const rows = data.messages.map((message, index) => ({ message, divider: index === 0 || dayOf(message.created_at) !== dayOf(data.messages[index - 1].created_at) ? dayLabel(message.created_at) : null }));
  const closed = data.conversation.status === "RESOLVED" || Boolean(data.conversation.ended_at);
  const short = (value: string) => new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en-US", { timeZone: zone, month: "short", day: "numeric" }).format(new Date(value));
  return (
    <>
      <PageIntro title={t("title")} subtitle={t("subtitle")} />
      <div className="grid gap-4 lg:grid-cols-[18rem_minmax(0,1fr)] xl:grid-cols-[18rem_minmax(0,40rem)]">
        <section className="card hidden overflow-hidden lg:block">
          <ul className="max-h-[68dvh] divide-y divide-ink/[0.06] overflow-y-auto">
            {conversations.map((item) => (
              <li key={item.id}>
                <Link href={`/messages/${item.id}`} className={cn("flex gap-3 px-4 py-3.5 hover:bg-pearl/70", item.id === id && "bg-gold/8")}>
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-gold text-[13px] font-semibold text-white">M</span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center justify-between gap-2">
                      <span className="truncate text-[13px] font-semibold">{item.subject ?? t("noSubject")}</span>
                      <span className="shrink-0 text-[11px] text-muted">{short(item.last_message_at)}</span>
                    </span>
                    <span className="block truncate text-[12px] text-muted">{item.last_message_preview ?? ""}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          <div className="border-t border-ink/[0.06] p-3">
            <Link href="/messages" className="flex h-9 w-full items-center justify-center gap-1.5 rounded-pill border border-gold/40 bg-white text-[12px] font-medium hover:border-gold">
              <Icon name="plus" size={14} />
              {t("new")}
            </Link>
          </div>
        </section>
        <section className="card flex h-[calc(100dvh-16rem)] min-h-[24rem] flex-col lg:h-[calc(100dvh-14rem)]">
          <header className="flex items-center gap-3 border-b border-ink/[0.06] px-5 py-4">
            <Link href="/messages" className="text-muted hover:text-ink lg:hidden" aria-label={t("title")}>
              <Icon name="chevron" size={16} className="rotate-180" />
            </Link>
            <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-gold text-[15px] font-semibold text-white">M</span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[15px] font-semibold">{t("supportName")}</span>
              <span className="block truncate text-[12px] text-muted">{data.conversation.subject}</span>
            </span>
            <Badge tone={conversationStatusTone[data.conversation.status]}>{statuses(data.conversation.status)}</Badge>
          </header>
          <ol className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 py-5">
            {rows.map(({ message, divider }) => (
              <MessageBubble key={message.id} message={message} divider={divider} time={timeOf(message.created_at)} initial={initial} />
            ))}
          </ol>
          <div className="border-t border-ink/[0.06] px-4 py-3">{closed ? <p className="text-[12px] text-muted">{t("closed")}</p> : <ReplyForm conversationId={id} />}</div>
        </section>
      </div>
    </>
  );
}
