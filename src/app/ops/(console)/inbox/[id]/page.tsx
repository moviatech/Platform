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
import { ScrollToEnd } from "@/features/inbox/ScrollToEnd";
import { PresenceDot } from "@/features/inbox/PresenceDot";
import { NotesPanel } from "@/features/inbox/NotesPanel";
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
import { aiConfigured } from "@/lib/ai/openai";
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
    countUnreadStaff(session.locationIds),
  ]);

  return (
    <>
      <PageHeader title={t("title")} />
      <InboxTabs active="conversations" notificationCount={unreadNotifications} />
    <div className="grid gap-5 lg:grid-cols-[20rem_minmax(0,1fr)] 2xl:h-[calc(100dvh-14rem)] 2xl:grid-cols-[20rem_minmax(0,1fr)_17rem]">
      <div className="hidden min-h-0 lg:flex lg:h-[70dvh] lg:flex-col 2xl:h-auto">
        <ConversationList conversations={conversations.map((item) => (item.id === id ? { ...item, unread: false } : item))} filters={filters} activeId={id} staff={staff} canManage={can(session, "inbox.manage")} />
      </div>

      <section className="card flex min-h-[70dvh] min-w-0 flex-col overflow-hidden lg:h-[70dvh] lg:min-h-0 2xl:h-auto">
        <header className="flex items-start justify-between gap-4 border-b border-ink/[0.07] px-4 py-3.5 sm:px-6">
          <div className="min-w-0">
            <Link href="/inbox" className="mb-1 inline-block text-xs text-muted hover:text-ink lg:hidden">
              ← {t("title")}
            </Link>
            <h1 className="flex items-center gap-2 truncate text-base font-semibold">
              <span className="truncate">{conversation.subject || t("noSubject")}</span>
              {lead?.reference && <span className="text-xs font-normal text-muted">#{lead.reference}</span>}
              {channel === "CHAT" && <PresenceDot conversationId={id} initial={conversation.customer_seen_at ?? null} labels={{ online: t("online"), offline: t("offline") }} />}
            </h1>
            <p className="truncate text-xs text-muted">{[conversation.customer_name || t("visitor"), conversation.customer_email, lead?.phone, lead?.wechat, channel === "CHAT" ? t("chat") : channel === "PORTAL" ? t("portal") : lead?.kind === "CONTACT" ? t("webForm") : t("email")].filter(Boolean).join(" · ")}</p>
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
          <Thread messages={messages.filter((message) => message.direction !== "INTERNAL")} chat={channel === "CHAT"} />
          <ScrollToEnd dep={messages[messages.length - 1]?.id ?? ""} />
        </div>
        <Composer conversationId={id} canReply={can(session, "inbox.reply")} channel={channel} emailAvailable={Boolean(conversation.customer_email)} defaultLanguage={conversation.locale === "zh" ? "zh" : "en"} ai={aiConfigured} />
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
        <NotesPanel conversationId={id} notes={messages.filter((message) => message.direction === "INTERNAL").map((message) => ({ id: message.id, body: message.body_text, author: message.from_name, at: message.created_at }))} canEdit={can(session, "inbox.view")} />
      </aside>
    </div>
    </>
  );
}
