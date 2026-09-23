import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { PageHeader } from "@/components/ops/PageHeader";
import { ApprovalDecision } from "@/features/finance/ApprovalForms";
import { listApprovals, type ApprovalRow } from "@/features/finance/approvals";
import { requirePagePermission } from "@/lib/auth/staff";
import { formatDateTime, formatMoney } from "@/lib/utils/format";

export const metadata: Metadata = { title: "Approvals" };

const tone: Record<ApprovalRow["status"], BadgeTone> = { PENDING: "warning", APPROVED: "success", DECLINED: "neutral", FAILED: "danger" };

export default async function ApprovalsPage() {
  await requirePagePermission("finance.approve");
  const [t, { pending, recent }] = await Promise.all([getTranslations("approvals"), listApprovals()]);

  const Row = ({ row, decide }: { row: ApprovalRow; decide: boolean }) => (
    <li className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5 text-[13px]">
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-2">
          {row.reservation_id ? (
            <Link href={`/reservations/${row.reservation_id}`} className="font-medium hover:text-gold">
              {row.reservation?.number ?? "—"}
            </Link>
          ) : row.withdrawal ? (
            <Link href={`/investors/${row.withdrawal.investor_id}`} className="font-medium hover:text-gold">
              {row.withdrawal.investor?.legal_name} · {row.withdrawal.investor?.investor_number}
            </Link>
          ) : (
            <span>—</span>
          )}
          <Badge tone="gold">{t(`kind.${row.kind}`)}</Badge>
          <span className="font-semibold tabular-nums">{formatMoney(row.amount_cents)}</span>
          {!decide && <Badge tone={tone[row.status]}>{t(`status.${row.status}`)}</Badge>}
        </p>
        <p className="mt-1 text-[12px] text-muted">
          {row.requester?.display_name ?? "—"} · {formatDateTime(row.created_at)}
          {row.reason ? ` · ${row.reason}` : ""}
          {row.decider ? ` → ${row.decider.display_name}${row.decision_note ? `: ${row.decision_note}` : ""}` : ""}
        </p>
      </div>
      {decide && <ApprovalDecision approvalId={row.id} />}
    </li>
  );

  return (
    <>
      <PageHeader title={t("title")} />
      <section className="card overflow-hidden">
        <h2 className="border-b border-ink/[0.07] bg-pearl/60 px-5 py-2.5 text-[11px] font-medium tracking-[0.12em] text-muted uppercase">{t("pending")}</h2>
        {pending.length === 0 ? <p className="px-5 py-8 text-center text-sm text-muted">{t("none")}</p> : <ul className="divide-y divide-ink/[0.06]">{pending.map((row) => <Row key={row.id} row={row} decide />)}</ul>}
      </section>
      {recent.length > 0 && (
        <section className="card mt-5 overflow-hidden">
          <h2 className="border-b border-ink/[0.07] bg-pearl/60 px-5 py-2.5 text-[11px] font-medium tracking-[0.12em] text-muted uppercase">{t("recent")}</h2>
          <ul className="divide-y divide-ink/[0.06]">{recent.map((row) => <Row key={row.id} row={row} decide={false} />)}</ul>
        </section>
      )}
    </>
  );
}
