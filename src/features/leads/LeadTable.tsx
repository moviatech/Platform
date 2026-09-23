import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/Badge";
import { formatDateTime } from "@/lib/utils/format";
import { leadStatusTone, type Lead } from "./types";

export async function LeadTable({ leads, backTo }: { leads: Lead[]; backTo?: string }) {
  const t = await getTranslations("leads");
  const common = await getTranslations("common");
  const locale = await getLocale();

  if (leads.length === 0) {
    return <div className="card px-6 py-14 text-center text-sm text-muted">{common("empty")}</div>;
  }

  return (
    <div className="card overflow-hidden">
      <div className="hidden grid-cols-[8.5rem_8rem_minmax(0,1fr)_minmax(0,1.6fr)_6rem] gap-4 border-b border-ink/[0.07] bg-pearl/60 px-5 py-2.5 text-[11px] font-medium tracking-[0.12em] text-muted uppercase md:grid">
        <span>{t("columns.received")}</span>
        <span>{t("columns.kind")}</span>
        <span>{t("columns.contact")}</span>
        <span>{t("columns.summary")}</span>
        <span className="text-right">{t("columns.status")}</span>
      </div>
      <ul className="divide-y divide-ink/[0.06]">
        {leads.map((lead) => (
          <li key={lead.id}>
            <Link
              href={`/leads/${lead.id}${backTo ? `?back=${encodeURIComponent(backTo)}` : ""}`}
              className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1 px-5 py-3.5 text-sm transition-colors hover:bg-gold/[0.04] md:grid-cols-[8.5rem_8rem_minmax(0,1fr)_minmax(0,1.6fr)_6rem] md:items-center"
            >
              <span className="order-3 text-xs text-muted md:order-none md:text-[13px]">{formatDateTime(lead.created_at, locale)}</span>
              <span className="order-4 text-right text-xs text-charcoal md:order-none md:text-left md:text-[13px]">{t(`kind.${lead.kind}`)}</span>
              <span className="order-1 min-w-0 md:order-none">
                <span className="block truncate font-medium">{lead.name || lead.email || lead.phone || "—"}</span>
                <span className="block truncate text-xs text-muted">{[lead.phone, lead.email].filter(Boolean).join(" · ")}</span>
              </span>
              <span className="order-5 col-span-2 truncate text-[13px] text-charcoal md:order-none md:col-span-1">{lead.summary ?? "—"}</span>
              <span className="order-2 text-right md:order-none">
                <Badge tone={leadStatusTone[lead.status]}>{t(`status.${lead.status}`)}</Badge>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
