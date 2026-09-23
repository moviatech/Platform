import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/Badge";
import { PageHeader } from "@/components/ops/PageHeader";
import { LedgerStatus, LedgerTabs } from "@/features/finance/ledger/LedgerChrome";
import { loadChecks } from "@/features/finance/ledger/views";
import { requirePagePermission } from "@/lib/auth/staff";
import { cn } from "@/lib/utils/cn";
import { formatDateTime } from "@/lib/utils/format";

export const metadata: Metadata = { title: "Checks" };

export default async function ChecksPage() {
  await requirePagePermission("finance.view");
  const [t, data] = await Promise.all([getTranslations("finance.ledger"), loadChecks()]);
  const grid = "grid min-w-[40rem] grid-cols-[10rem_5rem_5rem_5rem_5rem_minmax(0,1fr)] gap-4 px-5";

  return (
    <>
      <PageHeader title={t("titles.reports")} actions={<LedgerStatus />} />
      <LedgerTabs group="reports" current="checks" />
      <section className="card mb-6 p-5">
        <p className="mb-3 text-[13px] text-muted">{data.checks.date ? t("checks.date", { date: data.checks.date }) : t("checks.none")}</p>
        <ul className="grid gap-2 sm:grid-cols-2">
          {data.checks.results.map((result) => (
            <li key={result.name} className="flex items-center justify-between gap-3 rounded-lg px-3 py-2 hairline">
              <span className="text-[13px]">{t.has(`checks.names.${result.name}`) ? t(`checks.names.${result.name}`) : result.name}</span>
              <Badge tone={result.ok ? "success" : "danger"}>{result.ok ? t("checks.ok") : t("checks.failed", { count: result.count })}</Badge>
            </li>
          ))}
        </ul>
      </section>
      <h2 className="mb-3 text-[15px] font-semibold">{t("runs.title")}</h2>
      <section className="card overflow-x-auto">
        <div className={cn(grid, "border-b border-ink/[0.07] bg-pearl/60 py-2.5 text-[11px] font-medium tracking-[0.12em] text-muted uppercase")}>
          <span>{t("runs.started")}</span>
          <span>{t("runs.status")}</span>
          <span className="text-right">{t("runs.ms")}</span>
          <span className="text-right">{t("runs.posted")}</span>
          <span className="text-right">{t("runs.unchanged")}</span>
          <span>{t("runs.error")}</span>
        </div>
        <ul className="divide-y divide-ink/[0.06]">
          {data.runs.map((run) => {
            const ledger = run.counts.steps?.find((step) => step.name === "ledger")?.result as { posted?: number; unchanged?: number } | undefined;
            return (
              <li key={run.id} className={cn(grid, "py-2.5 text-[13px]")}>
                <span className="tabular-nums">{formatDateTime(run.started_at)}</span>
                <span>{run.finished_at === null ? <Badge tone="info">…</Badge> : <Badge tone={run.ok ? "success" : "danger"}>{run.ok ? t("checks.ok") : t("runs.failed")}</Badge>}</span>
                <span className="text-right tabular-nums">{run.counts.ms ?? ""}</span>
                <span className="text-right tabular-nums">{ledger?.posted ?? ""}</span>
                <span className="text-right tabular-nums">{ledger?.unchanged ?? ""}</span>
                <span className="min-w-0 truncate text-muted">{run.error ?? ""}</span>
              </li>
            );
          })}
        </ul>
      </section>
    </>
  );
}
