import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/ops/PageHeader";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Input, Select } from "@/components/ui/Field";
import { AuditTabs } from "@/features/audit/AuditTabs";
import { emailAudiences, listEmails, parseEmailFilter } from "@/features/audit/email-queries";
import { requirePagePermission } from "@/lib/auth/staff";
import { formatDateTime } from "@/lib/utils/format";

export const metadata: Metadata = { title: "Sent emails" };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

const pageSize = 100;

export default async function AuditEmailsPage({ searchParams }: Props) {
  await requirePagePermission("audit.view");
  const filter = parseEmailFilter(await searchParams);
  const [t, rows] = await Promise.all([getTranslations("audit"), listEmails(filter, pageSize + 1)]);
  const visible = rows.slice(0, pageSize);
  const query = new URLSearchParams({ from: filter.from, to: filter.to, audience: filter.audience, ...(filter.q ? { q: filter.q } : {}) });
  const older = rows.length > pageSize ? `/audit/emails?${query.toString()}&before=${encodeURIComponent(visible[visible.length - 1].created_at)}` : null;
  const grid = "md:grid-cols-[10rem_minmax(0,1fr)_minmax(0,1.6fr)_7rem_5rem]";

  return (
    <>
      <PageHeader title={t("title")} />
      <AuditTabs current="emails" />
      <form className="mb-5 flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-[12px] text-muted">
          {t("from")}
          <Input type="date" name="from" defaultValue={filter.from} className="h-9" />
        </label>
        <label className="flex flex-col gap-1 text-[12px] text-muted">
          {t("to")}
          <Input type="date" name="to" defaultValue={filter.to} className="h-9" />
        </label>
        <label className="flex flex-col gap-1 text-[12px] text-muted">
          {t("emails.audience")}
          <Select name="audience" defaultValue={filter.audience} className="h-9">
            {emailAudiences.map((audience) => (
              <option key={audience} value={audience}>
                {t(`emails.audiences.${audience}`)}
              </option>
            ))}
          </Select>
        </label>
        <label className="flex flex-col gap-1 text-[12px] text-muted">
          {t("emails.search")}
          <Input name="q" defaultValue={filter.q} maxLength={60} className="h-9 w-52" />
        </label>
        <Button type="submit" size="sm" variant="secondary">
          {t("apply")}
        </Button>
      </form>
      <div className="card overflow-hidden">
        <div className={`hidden gap-4 border-b border-ink/[0.07] bg-pearl/60 px-5 py-2.5 text-[11px] font-medium tracking-[0.12em] text-muted uppercase md:grid ${grid}`}>
          <span>{t("time")}</span>
          <span>{t("emails.recipient")}</span>
          <span>{t("emails.subject")}</span>
          <span>{t("emails.order")}</span>
          <span>{t("emails.status")}</span>
        </div>
        {visible.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-muted">{t("emails.empty")}</p>
        ) : (
          <ul className="divide-y divide-ink/[0.06]">
            {visible.map((row) => (
              <li key={row.id} className={`grid grid-cols-2 gap-x-4 gap-y-1 px-5 py-2.5 text-[13px] md:items-center ${grid}`}>
                <span className="text-muted tabular-nums">{formatDateTime(row.created_at)}</span>
                <span className="truncate">{row.recipients}</span>
                <Link href={`/audit/emails/${row.id}`} className="min-w-0 truncate font-medium hover:text-gold">
                  {row.subject}
                </Link>
                {row.reservation ? (
                  <Link href={`/reservations/${row.reservation.id}`} className="truncate hover:text-gold">
                    {row.reservation.number}
                  </Link>
                ) : (
                  <span className="text-muted">—</span>
                )}
                <span>
                  <Badge tone={row.sent ? "success" : "danger"}>{row.sent ? t("emails.sent") : t("emails.failed")}</Badge>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
      {older && (
        <div className="mt-4 text-center">
          <Link href={older} className="rounded-pill px-3.5 py-1.5 text-[13px] hairline hover:border-ink/25">
            {t("older")}
          </Link>
        </div>
      )}
    </>
  );
}
