import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/Badge";
import { conversationStatusTone } from "@/features/inbox/types";
import { loadPortalContent } from "@/features/portal/content";
import { ConversationRating } from "@/features/portal/ConversationRating";
import { MarkRead } from "@/features/portal/MarkRead";
import { endRequest } from "@/features/portal/request-actions";
import { getConversationRating, lastStaffResponder } from "@/features/ratings/service";
import { Icon } from "@/features/portal/icons";
import { LiveThread } from "@/features/portal/LiveThread";
import { MessageBubble, threadFormat } from "@/features/portal/MessageBubble";
import { MessagesLayout } from "@/features/portal/MessagesLayout";
import { listTrips } from "@/features/portal/queries";
import { getRequest, listRequests } from "@/features/portal/request-queries";
import { ReplyForm } from "@/features/portal/RequestForms";
import { PageIntro, whitePill } from "@/features/portal/ui";
import { requireCustomer } from "@/lib/auth/customer";
import { createAdminClient } from "@/lib/supabase/admin";

export const metadata: Metadata = { title: "Message" };

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ status?: string; q?: string }> };

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function MessagePage({ params, searchParams }: Props) {
  const session = await requireCustomer();
  const [{ id }, { status, q }] = await Promise.all([params, searchParams]);
  if (!uuid.test(id)) notFound();
  const data = await getRequest(session.customerId, id);
  if (!data) notFound();
  const wasUnread = data.request.customer_unread;
  const readAt = new Date().toISOString();
  await createAdminClient().from("conversations").update({ customer_read_at: readAt, customer_unread: false }).eq("id", id).eq("customer_id", session.customerId);
  const resolved = data.request.status === "RESOLVED";
  const [t, brand, statuses, tr, locale, trips, requests, content, rating, responder] = await Promise.all([
    getTranslations("portal.messages"),
    getTranslations("portal.brand"),
    getTranslations("inbox.status"),
    getTranslations("portal.ratings"),
    getLocale(),
    listTrips(session.customerId),
    listRequests(session.customerId),
    loadPortalContent(),
    resolved ? getConversationRating(id) : Promise.resolve(null),
    resolved ? lastStaffResponder(id) : Promise.resolve(null),
  ]);
  const trip = trips.find((item) => item.id === data.request.reservation_id) ?? null;
  const { dayOf, dayLabel, timeOf } = threadFormat(locale, t("today"));
  const initial = session.fullName.trim().slice(0, 1).toUpperCase();
  const rows = data.messages.map((message, index) => ({ message, divider: index === 0 || dayOf(message.created_at) !== dayOf(data.messages[index - 1].created_at) ? dayLabel(message.created_at) : null }));
  const last = data.messages[data.messages.length - 1] ?? null;

  return (
    <>
      <PageIntro title={t("title")} subtitle={t("subtitle")} tagline={[brand("t1"), brand("t2")]} />
      <MarkRead id={id} unread={wasUnread} />
      <MessagesLayout requests={requests.map((item) => (item.id === id ? { ...item, customer_read_at: readAt, customer_unread: false } : item))} activeId={id} trip={trip} content={content} query={q} status={status}>
        <section className="card flex min-h-[32rem] flex-col">
          <header className="flex items-center gap-3 border-b border-ink/[0.06] px-5 py-4">
            <Link href="/messages" className="text-muted hover:text-ink lg:hidden" aria-label={t("inbox")}>
              <Icon name="chevron" size={16} className="rotate-180" />
            </Link>
            <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-gold text-[15px] font-semibold text-white">M</span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[15px] font-semibold">{t("supportName")}</span>
              <span className="block truncate text-[12px] text-muted">{data.request.subject ?? t("supportLine")}</span>
            </span>
            <Badge tone={conversationStatusTone[data.request.status]}>{statuses(data.request.status)}</Badge>
            {!resolved && (
              <form action={endRequest}>
                <input type="hidden" name="conversationId" value={id} />
                <button type="submit" className={`${whitePill} h-8 px-3 text-[12px]`}>
                  {tr("end")}
                </button>
              </form>
            )}
          </header>
          <ol className="flex flex-1 flex-col gap-4 px-5 py-5">
            {rows.map(({ message, divider }) => (
              <MessageBubble key={message.id} message={message} divider={divider} time={timeOf(message.created_at)} initial={initial} />
            ))}
            {!resolved && <LiveThread key={last?.id ?? ""} conversationId={id} lastMessageId={last?.id ?? ""} lastMessageAt={last?.created_at ?? null} locale={locale} customerInitial={initial} />}
          </ol>
          {resolved ? (
            <div className="border-t border-ink/[0.06] px-5 py-5">
              <p className="mb-3 text-[12px] text-muted">{tr("ended")}{data.request.ended_at ? ` · ${timeOf(data.request.ended_at)}` : ""}</p>
              <ConversationRating conversationId={id} name={responder?.displayName ?? tr("team")} rating={rating ? { score: rating.score, comment: rating.comment } : null} />
            </div>
          ) : (
            <div className="border-t border-ink/[0.06] px-4 py-3">
              <ReplyForm conversationId={id} />
            </div>
          )}
        </section>
      </MessagesLayout>
    </>
  );
}
