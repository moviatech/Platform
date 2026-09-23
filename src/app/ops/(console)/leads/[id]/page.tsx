import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/Badge";
import { Button, ButtonLink } from "@/components/ui/Button";
import { BackLink, safeBack } from "@/components/ops/BackLink";
import { PageHeader } from "@/components/ops/PageHeader";
import { startConversationFromLead } from "@/features/inbox/actions";
import { findConversationForLead } from "@/features/inbox/queries";
import { LeadManageForm } from "@/features/leads/LeadManageForm";
import { getLead, listEntityAudit } from "@/features/leads/queries";
import { leadStatusTone } from "@/features/leads/types";
import { can, requirePagePermission } from "@/lib/auth/staff";
import { formatFullDateTime } from "@/lib/utils/format";

export const metadata: Metadata = { title: "Lead" };

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ back?: string }> };

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function Row({ label, value, href }: { label: string; value: string | null; href?: string }) {
  if (!value) return null;
  return (
    <div className="flex items-baseline justify-between gap-6 py-2.5">
      <dt className="shrink-0 text-[13px] text-muted">{label}</dt>
      <dd className="min-w-0 text-right text-sm break-words">
        {href ? (
          <a href={href} className="underline decoration-gold/50 underline-offset-4 hover:decoration-gold">
            {value}
          </a>
        ) : (
          value
        )}
      </dd>
    </div>
  );
}

function PayloadValue({ value }: { value: unknown }) {
  if (value === null || value === undefined || value === "") return <span className="text-muted">—</span>;
  if (typeof value === "object") {
    return <pre className="overflow-x-auto rounded-lg bg-pearl px-3 py-2 text-left font-mono text-[12px] leading-relaxed">{JSON.stringify(value, null, 2)}</pre>;
  }
  return <span className="whitespace-pre-wrap">{String(value)}</span>;
}

export default async function LeadDetailPage({ params, searchParams }: Props) {
  const session = await requirePagePermission("lead.view");
  const { id } = await params;
  const { back } = await searchParams;
  if (!uuid.test(id)) notFound();

  const lead = await getLead(id);
  if (!lead) notFound();

  const t = await getTranslations("leads");
  const common = await getTranslations("common");
  const locale = await getLocale();
  const activity = await listEntityAudit("lead", lead.id);
  const entries = Object.entries(lead.payload ?? {});
  const conversationId = can(session, "inbox.view") ? await findConversationForLead(lead.id) : null;

  return (
    <>
      <BackLink href={safeBack(back, "/inbox?view=handoffs")} />
      <PageHeader
        eyebrow={t(`kind.${lead.kind}`)}
        title={lead.name || lead.email || lead.phone || t("title")}
        lead={formatFullDateTime(lead.created_at, locale)}
        actions={
          <div className="flex items-center gap-3">
            {conversationId ? (
              <ButtonLink href={`/inbox/${conversationId}`} size="sm" variant="secondary">
                {t("detail.openConversation")}
              </ButtonLink>
            ) : lead.email && can(session, "inbox.reply") ? (
              <form action={startConversationFromLead}>
                <input type="hidden" name="leadId" value={lead.id} />
                <Button type="submit" size="sm" variant="secondary">
                  {t("detail.emailCustomer")}
                </Button>
              </form>
            ) : null}
            {lead.kind === "BOOKING_REQUEST" && lead.status !== "CONVERTED" && can(session, "reservation.create") && (
              <ButtonLink href={"/reservations/new?lead=" + lead.id} size="sm">
                {t("convert")}
              </ButtonLink>
            )}
            <Badge tone={leadStatusTone[lead.status]}>{t(`status.${lead.status}`)}</Badge>
          </div>
        }
      />
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="flex min-w-0 flex-col gap-5">
          <section className="card p-6">
            <h2 className="text-sm font-semibold">{t("detail.contact")}</h2>
            <dl className="mt-2 divide-y divide-ink/[0.06]">
              <Row label={t("detail.name")} value={lead.name} />
              <Row label={t("detail.phone")} value={lead.phone} href={lead.phone ? `tel:${lead.phone}` : undefined} />
              <Row label={t("detail.email")} value={lead.email} href={lead.email ? `mailto:${lead.email}` : undefined} />
              <Row label={t("detail.wechat")} value={lead.wechat} />
              <Row label={t("detail.locale")} value={lead.locale} />
              <Row label={t("detail.reference")} value={lead.reference} />
              <Row label={t("detail.source")} value={lead.source_url} />
            </dl>
          </section>
          <section className="card p-6">
            <h2 className="text-sm font-semibold">{t("detail.submitted")}</h2>
            {lead.summary && <p className="mt-2 text-sm text-charcoal">{lead.summary}</p>}
            <dl className="mt-3 divide-y divide-ink/[0.06]">
              {entries.map(([key, value]) => (
                <div key={key} className="grid gap-1 py-2.5 sm:grid-cols-[10rem_minmax(0,1fr)] sm:gap-6">
                  <dt className="font-mono text-[12px] text-muted">{key}</dt>
                  <dd className="min-w-0 text-sm">
                    <PayloadValue value={value} />
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        </div>
        <div className="flex flex-col gap-5">
          <section className="card p-6">
            <h2 className="mb-4 text-sm font-semibold">{t("detail.manage")}</h2>
            <LeadManageForm lead={lead} editable={can(session, "lead.edit")} />
          </section>
          <section className="card p-6">
            <h2 className="text-sm font-semibold">{t("detail.activity")}</h2>
            {activity.length === 0 ? (
              <p className="mt-3 text-[13px] text-muted">{common("empty")}</p>
            ) : (
              <ol className="mt-3 flex flex-col gap-3">
                {activity.map((event) => (
                  <li key={event.id} className="text-[13px]">
                    <p className="font-mono text-[12px] text-charcoal">{event.action}</p>
                    <p className="text-xs text-muted">
                      {formatFullDateTime(event.created_at, locale)}
                      {typeof event.metadata.by === "string" ? ` · ${event.metadata.by}` : ""}
                      {typeof event.metadata.to === "string" ? ` · ${String(event.metadata.from)} → ${event.metadata.to}` : ""}
                    </p>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>
      </div>
    </>
  );
}
