import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/ops/PageHeader";
import { LeadTable } from "@/features/leads/LeadTable";
import { listLeads } from "@/features/leads/queries";
import { leadStatuses } from "@/features/leads/types";
import { requirePagePermission } from "@/lib/auth/staff";
import { cn } from "@/lib/utils/cn";

export const metadata: Metadata = { title: "Leads" };

type Props = { searchParams: Promise<{ status?: string; kind?: string }> };

export default async function LeadsPage({ searchParams }: Props) {
  await requirePagePermission("lead.view");
  const filters = await searchParams;
  const t = await getTranslations("leads");
  const leads = await listLeads(filters);

  const current = filters.status ?? "open";
  const tabs = [
    { key: "open", label: `${t("status.NEW")} + ${t("status.IN_PROGRESS")}`, href: "/leads" },
    ...leadStatuses.slice(2).map((status) => ({ key: status as string, label: t(`status.${status}`), href: `/leads?status=${status}` })),
    { key: "all", label: (await getTranslations("common"))("all"), href: "/leads?status=all" },
  ];

  return (
    <>
      <PageHeader title={t("title")} lead={t("lead")} />
      <div className="no-scrollbar mb-4 flex gap-1.5 overflow-x-auto">
        {tabs.map((tab) => (
          <Link
            key={tab.key}
            href={tab.href}
            className={cn(
              "shrink-0 rounded-pill px-3.5 py-1.5 text-[13px] transition-colors",
              current === tab.key ? "bg-ink text-white" : "bg-white text-charcoal hairline hover:border-ink/20",
            )}
          >
            {tab.label}
          </Link>
        ))}
      </div>
      <LeadTable leads={leads} />
    </>
  );
}
