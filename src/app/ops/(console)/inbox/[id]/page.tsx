import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/Badge";
import { withBack } from "@/components/ops/BackLink";
import { PageHeader } from "@/components/ops/PageHeader";
import { InboxTabs } from "@/features/inbox/InboxTabs";
import { countUnreadStaff } from "@/features/notifications/center";
import { Composer } from "@/features/inbox/Composer";
import { getInvestor } from "@/features/investor/ops-queries";
import { getConversationRating } from "@/features/ratings/service";
import { ConversationList } from "@/features/inbox/ConversationList";
import { ManagePanel } from "@/features/inbox/ManagePanel";
import { Thread } from "@/features/inbox/Thread";
import {
  getConversation,
  listConversations,
  listMessages,
  listOtherConversations,
  listStaffDirectory,
  type InboxFilters,
} from "@/features/inbox/queries";
import { conversationStatusTone, replyChannelFor } from "@/features/inbox/types";
import { can, requirePagePermission } from "@/lib/auth/staff";
import { rootDomain } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

type LeadCard = { id: string; kind: string; status: string; reference: string | null; name: string | null; phone: string | null; wechat: string | null; payload: Record<string, unknown> };

async function leadCard(leadId: string | null): Promise<LeadCard | null> {
  if (!leadId) return null;
  const supabase = await createClient();
  const { data } = await supabase.from("leads").select("id, kind, status, reference, name, phone, wechat, payload").eq("id", leadId).maybeSingle();
  return (data as LeadCard | null) ?? null;
}

export const metadata: Metadata = { title: "Inbox" };

type Props = { params: Promise<{ id: string }>; searchParams: Promise<InboxFilters> };

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function ConversationPage({ params, searchParams }: Props) {
  const session = await requirePagePermission("inbox.view");
  const { id } = await params;
  if (!uuid.test(id)) notFound();
  const filters = await searchParams;

  const conversation = await getConversation(id);
  if (!conversation) notFound();

  if (conversation.unread) {
    const supabase = await createClient();
    await supabase.from("conversations").update({ unread: false }).eq("id", id);
    conversation.unread = false;
  }

  const rating = conversation.customer_id ? await getConversationRating(id) : null;
  const investor = conversation.investor_id ? await getInvestor(conversation.investor_id) : null;
  const channel = replyChannelFor(conversation);
  const [t, conversations, messages, others, staff, , lead, unreadNotifications] = await Promise.all([
    getTranslations("inbox"),
    listConversations(filters, session.userId),
    listMessages(id),
    conversation.customer_email ? listOtherConversations(conversation.customer_email, id) : Promise.resolve([]),
    listStaffDirectory(),
    Promise.resolve(0),
    leadCard(conversation.lead_id),
    countUnreadStaff(),
  ]);

  return (
    <>
      <PageHeader title={t("title")} />
      <InboxTabs active="conversations" notificationCount={unreadNotifications} />
    <div className="grid gap-5 lg:h-[calc(100dvh-14rem)] lg:grid-cols-[20rem_minmax(0,1fr)] 2xl:grid-cols-[20rem_minmax(0,1fr)_17rem]">
      <div className="hidden min-h-0 lg:flex lg:flex-col">
        <ConversationList conversations={conversations.map((item) => (item.id === id ? { ...item, unread: false } : item))} filters={filters} activeId={id} />
      </div>

      <section className="card flex min-h-[70dvh] min-w-0 flex-col overflow-hidden lg:min-h-0">
        <header className="flex items-start justify-between gap-4 border-b border-ink/[0.07] px-4 py-3.5 sm:px-6">
          <div className="min-w-0">
            <Link href="/inbox" className="mb-1 inline-block text-xs text-muted hover:text-ink lg:hidden">
              ← {t("title")}
            </Link>
            <h1 className="truncate text-base font-semibold">
              {conversation.subject || t("noSubject")}
              {lead?.reference && <span className="ml-2 text-xs font-normal text-muted">#{lead.reference}</span>}
            </h1>
            <p className="truncate text-xs text-muted">{[conversation.customer_name || t("visitor"), conversation.customer_email].filter(Boolean).join(" · ")}</p>
          </div>
          {rating && (
            <Badge tone="gold" className="shrink-0">
              {t("rating")} ★{rating.score}
            </Badge>
          )}
          <Badge tone={conversationStatusTone[conversation.status]} className="shrink-0">
            {t(`status.${conversation.status}`)}
          </Badge>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto bg-pearl/40">
          <Thread messages={messages} chat={channel === "CHAT"} />
        </div>
        <Composer conversationId={id} canReply={can(session, "inbox.reply")} channel={channel} />
      </section>

      <aside className="flex min-w-0 flex-col gap-5 lg:col-start-2 2xl:col-start-auto 2xl:overflow-y-auto">
          {investor && (
            <section className="card p-5">
              <p className="eyebrow mb-2">{t("investor")}</p>
              <Link href={`/investors/${investor.id}`} className="block text-[15px] font-semibold hover:text-gold">
                {investor.legal_name}
              </Link>
              <p className="text-[12px] text-muted">
                {investor.investor_number} · {investor.phone}
              </p>
            </section>
          )}
        <section className="card p-5">
          <h2 className="mb-3.5 text-sm font-semibold">{t("panel.manage")}</h2>
          <ManagePanel conversation={conversation} staff={staff} editable={can(session, "inbox.manage")} domain={rootDomain} />
        </section>
        <section className="card p-5 text-[13px]">
          <h2 className="mb-2 text-sm font-semibold">{t("panel.customer")}</h2>
          <p className="font-medium">{conversation.customer_name || (conversation.customer_email ? "—" : t("visitor"))}</p>
          {conversation.customer_email && (
            <a href={`mailto:${conversation.customer_email}`} className="break-all text-charcoal underline decoration-gold/50 underline-offset-4">
              {conversation.customer_email}
            </a>
          )}
          {conversation.reservation && can(session, "reservation.view") && (
            <p className="mt-3">
              <Link href={withBack(`/reservations/${conversation.reservation.id}`, `/inbox/${id}`)} className="text-charcoal underline decoration-gold/50 underline-offset-4 hover:decoration-gold">
                {t("panel.viewReservation", { number: conversation.reservation.number })} →
              </Link>
            </p>
          )}
          {lead && can(session, "lead.view") && (
            <div className="mt-3 flex flex-col gap-1.5">
              {[
                [t("panel.phone"), lead.phone],
                [t("panel.wechat"), lead.wechat],
                [t("panel.topic"), typeof lead.payload.topic === "string" ? lead.payload.topic : null],
                [t("panel.vehicle"), typeof lead.payload.vehicleSlug === "string" ? lead.payload.vehicleSlug : null],
                [t("panel.dates"), typeof lead.payload.pickupDate === "string" && typeof lead.payload.returnDate === "string" ? `${lead.payload.pickupDate} → ${lead.payload.returnDate}` : null],
              ]
                .filter((row): row is [string, string] => Boolean(row[1]))
                .map(([label, value]) => (
                  <p key={label} className="flex justify-between gap-3">
                    <span className="text-muted">{label}</span>
                    <span className="text-right break-all">{value}</span>
                  </p>
                ))}
              {lead.status !== "CONVERTED" && can(session, "reservation.create") && (
                <Link href={withBack(`/reservations/new?lead=${lead.id}`, `/inbox/${id}`)} className="mt-1 inline-flex h-8 w-fit items-center rounded-pill bg-ink px-3.5 text-[13px] font-medium text-white">
                  {t("panel.createReservation")}
                </Link>
              )}
              <Link href={withBack(`/leads/${lead.id}`, `/inbox/${id}`)} className="text-charcoal underline decoration-gold/50 underline-offset-4 hover:decoration-gold">
                {t("panel.viewLead")} →
              </Link>
            </div>
          )}
          {!lead && can(session, "reservation.create") && (
            <Link href={withBack(`/reservations/new?conversation=${id}`, `/inbox/${id}`)} className="mt-3 inline-flex h-8 w-fit items-center rounded-pill bg-ink px-3.5 text-[13px] font-medium text-white">
              {t("panel.createReservation")}
            </Link>
          )}
          {others.length > 0 && (
            <>
              <h3 className="mt-4 mb-1.5 text-xs font-medium tracking-wide text-muted">{t("panel.history")}</h3>
              <ul className="flex flex-col gap-1.5">
                {others.map((item) => (
                  <li key={item.id}>
                    <Link href={`/inbox/${item.id}`} className="block truncate text-charcoal hover:text-ink">
                      {item.subject || t("noSubject")}
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      </aside>
    </div>
    </>
  );
}
