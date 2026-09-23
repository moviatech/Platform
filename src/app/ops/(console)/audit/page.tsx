import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { AuditAction } from "@/components/ops/AuditAction";
import { Button } from "@/components/ui/Button";
import { Input, Select } from "@/components/ui/Field";
import { PageHeader } from "@/components/ops/PageHeader";
import { auditActors, auditDetail, auditEntityHref, listAudit, parseAuditFilter } from "@/features/audit/queries";
import { requirePagePermission } from "@/lib/auth/staff";
import { formatDateTime } from "@/lib/utils/format";

export const metadata: Metadata = { title: "Audit log" };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

const pageSize = 100;

export default async function AuditPage({ searchParams }: Props) {
  await requirePagePermission("audit.view");
  const filter = parseAuditFilter(await searchParams);
  const [t, rows] = await Promise.all([getTranslations("audit"), listAudit(filter, pageSize + 1)]);
  const visible = rows.slice(0, pageSize);
  const query = new URLSearchParams({ from: filter.from, to: filter.to, ...(filter.actor ? { actor: filter.actor } : {}), ...(filter.q ? { q: filter.q } : {}) });
  const older = rows.length > pageSize ? `/audit?${query.toString()}&before=${encodeURIComponent(visible[visible.length - 1].created_at)}` : null;
  const grid = "md:grid-cols-[10rem_9rem_minmax(0,1.1fr)_9rem_minmax(0,1.2fr)]";

  return (
    <>
      <PageHeader
        title={t("title")}
        actions={
          <a href={`/audit/export?${query.toString()}`} className="inline-flex h-8 items-center rounded-pill px-3.5 text-[13px] font-medium hairline hover:border-ink/25">
            {t("export")}
          </a>
        }
      />
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
          {t("actor")}
          <Select name="actor" defaultValue={filter.actor} className="h-9">
            <option value="">{t("any")}</option>
            {auditActors.map((actor) => (
              <option key={actor} value={actor}>
                {t(`actors.${actor}`)}
              </option>
            ))}
          </Select>
        </label>
        <label className="flex flex-col gap-1 text-[12px] text-muted">
          {t("search")}
          <Input name="q" defaultValue={filter.q} maxLength={60} className="h-9 w-44" />
        </label>
        <Button type="submit" size="sm" variant="secondary">
          {t("apply")}
        </Button>
      </form>
      <div className="card overflow-hidden">
        <div className={`hidden gap-4 border-b border-ink/[0.07] bg-pearl/60 px-5 py-2.5 text-[11px] font-medium tracking-[0.12em] text-muted uppercase md:grid ${grid}`}>
          <span>{t("time")}</span>
          <span>{t("actor")}</span>
          <span>{t("action")}</span>
          <span>{t("entity")}</span>
          <span>{t("detail")}</span>
        </div>
        {visible.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-muted">{t("empty")}</p>
        ) : (
          <ul className="divide-y divide-ink/[0.06]">
            {visible.map((row) => {
              const href = auditEntityHref(row);
              return (
                <li key={row.id} className={`grid grid-cols-2 gap-x-4 gap-y-1 px-5 py-2.5 text-[13px] md:items-center ${grid}`}>
                  <span className="text-muted tabular-nums">{formatDateTime(row.created_at)}</span>
                  <span className="truncate">{row.actor_name ?? t(`actors.${row.actor_type}`)}</span>
                  <span className="min-w-0">
                    <span className="font-medium">
                      <AuditAction action={row.action} />
                    </span>
                    <span className="ml-2 text-[11px] text-muted">{row.action}</span>
                  </span>
                  {href ? (
                    <Link href={href} className="truncate hover:text-gold">
                      {row.entity_type}
                    </Link>
                  ) : (
                    <span className="truncate text-muted">{row.entity_type}</span>
                  )}
                  <span className="min-w-0 truncate text-muted">{auditDetail(row.metadata)}</span>
                </li>
              );
            })}
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
