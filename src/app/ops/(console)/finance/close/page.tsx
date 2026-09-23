import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/Badge";
import { PageHeader } from "@/components/ops/PageHeader";
import { zonedParts } from "@/features/booking/time";
import { loadDue } from "@/features/finance/board/queries";
import { LedgerStatus, LedgerTabs } from "@/features/finance/ledger/LedgerChrome";
import { ApproveButton, InclusionForm, ResolutionForm, ResolveForm, VoidForm } from "@/features/finance/ledger/LedgerForms";
import { APPROVAL_THRESHOLD_CENTS } from "@/features/finance/ledger/other-targets";
import { loadPending, type ExceptionRow } from "@/features/finance/ledger/views";
import { can, requirePagePermission } from "@/lib/auth/staff";
import { formatDateTime, formatMoney } from "@/lib/utils/format";

export const metadata: Metadata = { title: "Month-end" };

const brief = (detail: Record<string, unknown>) =>
  Object.entries(detail)
    .filter(([key, value]) => key !== "number" && value !== null && typeof value !== "object")
    .map(([key, value]) => `${key}: ${value}`)
    .join(" · ");

export default async function ClosePage() {
  const session = await requirePagePermission("finance.view");
  const [t, data, due] = await Promise.all([getTranslations("finance.ledger"), loadPending(), loadDue(zonedParts(new Date(), "America/Los_Angeles").date)]);
  const dueTotal = due.service + due.recurring;
  const editor = can(session, "finance.ledger");
  const byKind = new Map<string, ExceptionRow[]>();
  for (const row of data.open) byKind.set(row.kind, [...(byKind.get(row.kind) ?? []), row]);
  const kindLabel = (kind: string) => (t.has(`kinds.${kind}`) ? t(`kinds.${kind}`) : kind);
  const subject = (row: ExceptionRow) =>
    row.reservation_id ? (
      <Link href={`/reservations/${row.reservation_id}`} className="font-medium hover:text-gold">
        {data.orders.get(row.reservation_id) ?? row.reservation_id.slice(0, 8)}
      </Link>
    ) : row.investor_id ? (
      <Link href={`/investors/${row.investor_id}`} className="font-medium hover:text-gold">
        {data.investors.get(row.investor_id) ?? row.investor_id.slice(0, 8)}
      </Link>
    ) : (
      <span className="text-muted">{row.source_key ?? ""}</span>
    );

  return (
    <>
      <PageHeader title={t("titles.close")} actions={<LedgerStatus />} />
      <LedgerTabs group="close" current="pending" />

      {dueTotal > 0 && (
        <section className="card mb-6 overflow-hidden">
          <h3 className="flex items-center gap-2 bg-pearl/60 px-5 py-2.5 text-[13px] font-semibold">
            {t("due.title")}
            <Badge tone="warning">{dueTotal}</Badge>
          </h3>
          <ul className="divide-y divide-ink/[0.06]">
            {due.recurring > 0 && (
              <li className="px-5 py-2.5 text-[13px]">
                <Link href="/finance/books/expenses" className="hover:text-gold">
                  {t("due.recurring", { count: due.recurring })}
                </Link>
              </li>
            )}
            {due.service > 0 && (
              <li className="px-5 py-2.5 text-[13px]">
                <Link href="/finance/books/expenses" className="hover:text-gold">
                  {t("due.service", { count: due.service })}
                </Link>
              </li>
            )}
          </ul>
        </section>
      )}

      {(data.open.length > 0 || dueTotal === 0) && (
        <section className="card mb-6 overflow-hidden">
          {data.open.length === 0 ? (
            <p className="px-5 py-10 text-center text-sm text-muted">{t("pending.none")}</p>
          ) : (
            [...byKind].map(([kind, rows]) => (
              <div key={kind} className="border-b border-ink/[0.07] last:border-b-0">
                <h3 className="flex items-center gap-2 bg-pearl/60 px-5 py-2.5 text-[13px] font-semibold">
                  {kindLabel(kind)}
                  <Badge tone="warning">{rows.length}</Badge>
                </h3>
                <ul className="divide-y divide-ink/[0.06]">
                  {rows.map((row) => (
                    <li key={row.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-2.5 text-[13px]">
                      <span className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
                        {subject(row)}
                        <span className="min-w-0 truncate text-muted">{brief(row.detail)}</span>
                        <span className="text-[11px] text-muted tabular-nums">{formatDateTime(row.opened_at)}</span>
                      </span>
                      {editor && <ResolveForm id={row.id} />}
                    </li>
                  ))}
                </ul>
              </div>
            ))
          )}
        </section>
      )}

      <h2 className="mb-3 text-[15px] font-semibold">{t("resolutions.title")}</h2>
      <section className="card mb-6 overflow-hidden">
        {editor && (
          <div className="border-b border-ink/[0.07] p-5">
            <ResolutionForm />
          </div>
        )}
        {data.resolutions.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-muted">{t("resolutions.none")}</p>
        ) : (
          <ul className="divide-y divide-ink/[0.06]">
            {data.resolutions.map((row) => {
              const waiting = !row.voided_at && !row.approved_by && row.amount_cents > APPROVAL_THRESHOLD_CENTS;
              return (
                <li key={row.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-2.5 text-[13px]">
                  <span className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
                    <Link href={`/reservations/${row.reservation_id}`} className="font-medium hover:text-gold">
                      {data.orders.get(row.reservation_id) ?? row.reservation_id.slice(0, 8)}
                    </Link>
                    <span>{t(`resolutions.categories.${row.category}`)}</span>
                    <span className="tabular-nums">{formatMoney(row.amount_cents)}</span>
                    <span className="min-w-0 truncate text-muted">{row.reason}</span>
                    <span className="text-[11px] text-muted">{data.names.get(row.created_by) ?? ""}</span>
                    {row.voided_at ? <Badge tone="neutral">{t("resolutions.voided")}</Badge> : waiting ? <Badge tone="warning">{t("resolutions.needsApproval")}</Badge> : row.approved_by ? <Badge tone="success">{t("resolutions.approved")}</Badge> : null}
                  </span>
                  {editor && !row.voided_at && (
                    <span className="flex flex-wrap items-center gap-2">
                      {waiting && row.created_by !== session.userId && <ApproveButton id={row.id} />}
                      <VoidForm id={row.id} />
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {editor && (
        <>
          <h2 className="mb-3 text-[15px] font-semibold">{t("inclusion.title")}</h2>
          <section className="card mb-6 p-5">
            <InclusionForm />
          </section>
        </>
      )}

      {data.resolved.length > 0 && (
        <details className="card overflow-hidden">
          <summary className="cursor-pointer px-5 py-3 text-[13px] font-medium">{t("pending.resolved")}</summary>
          <ul className="divide-y divide-ink/[0.06] border-t border-ink/[0.07]">
            {data.resolved.map((row) => (
              <li key={row.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-2.5 text-[13px]">
                <span>{kindLabel(row.kind)}</span>
                {subject(row)}
                <span className="min-w-0 truncate text-muted">{row.note ?? ""}</span>
                <span className="text-[11px] text-muted tabular-nums">{row.resolved_at ? formatDateTime(row.resolved_at) : ""}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </>
  );
}
