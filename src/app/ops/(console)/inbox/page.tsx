import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/ops/PageHeader";
import { ConversationList } from "@/features/inbox/ConversationList";
import { InboxTabs } from "@/features/inbox/InboxTabs";
import { listConversations, type InboxFilters } from "@/features/inbox/queries";
import { LeadTable } from "@/features/leads/LeadTable";
import { countOpenLeads, listLeads } from "@/features/leads/queries";
import { handoffKinds } from "@/features/leads/types";
import { can, requirePagePermission } from "@/lib/auth/staff";

export const metadata: Metadata = { title: "Inbox" };

type Props = { searchParams: Promise<InboxFilters & { view?: string }> };

export default async function InboxPage({ searchParams }: Props) {
  const session = await requirePagePermission("inbox.view");
  const { view, ...filters } = await searchParams;
  const t = await getTranslations("inbox");
  const showHandoffs = can(session, "lead.view");
  const handoffs = view === "handoffs" && showHandoffs;

  const [conversations, leads, handoffCount] = await Promise.all([
    handoffs ? Promise.resolve([]) : listConversations(filters, session.userId),
    handoffs ? listLeads({ kinds: handoffKinds }) : Promise.resolve([]),
    showHandoffs ? countOpenLeads(handoffKinds) : Promise.resolve(0),
  ]);

  return (
    <>
      <PageHeader title={t("title")} />
      <InboxTabs active={handoffs ? "handoffs" : "conversations"} handoffCount={handoffCount} showHandoffs={showHandoffs} />
      {handoffs ? (
        <LeadTable leads={leads} backTo="/inbox?view=handoffs" />
      ) : (
        <div className="grid gap-5 lg:h-[calc(100dvh-14rem)] lg:grid-cols-[20rem_minmax(0,1fr)]">
          <ConversationList conversations={conversations} filters={filters} />
          <div className="card hidden items-center justify-center text-[13px] text-muted lg:flex">{t("pick")}</div>
        </div>
      )}
    </>
  );
}
