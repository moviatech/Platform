import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { getLocale, getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/ops/PageHeader";
import { getRatingsOverview, listRecentRatings, listSurveyReasons } from "@/features/ratings/queries";
import { lowScoreMax } from "@/features/ratings/types";
import { requirePagePermission } from "@/lib/auth/staff";
import { cn } from "@/lib/utils/cn";
import { formatDateTime } from "@/lib/utils/format";

export const metadata: Metadata = { title: "Ratings" };

const head = "hidden gap-4 border-b border-ink/[0.07] bg-pearl/60 px-5 py-2.5 text-[11px] font-medium tracking-[0.12em] text-muted uppercase md:grid";
const staffGrid = "md:grid-cols-[minmax(0,1.6fr)_5rem_5rem_5rem_5rem_5rem_5rem]";
const recentGrid = "md:grid-cols-[7rem_6rem_6rem_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.6fr)_4rem]";

function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div className="card p-5">
      <p className="text-[13px] text-muted">{label}</p>
      <p className="mt-1.5 text-3xl font-semibold tracking-tight tabular-nums">{value}</p>
      {hint && <p className="mt-1.5 text-xs text-muted">{hint}</p>}
    </div>
  );
}

function Stars({ score }: { score: number }) {
  return (
    <span className="whitespace-nowrap text-[13px] tracking-[0.08em] text-gold">
      {"★".repeat(score)}
      <span className="text-ink/15">{"★".repeat(5 - score)}</span>
    </span>
  );
}

function Section({ title, empty, children }: { title: string; empty: boolean; children: ReactNode }) {
  return (
    <section className="mt-6">
      <h2 className="mb-3 text-sm font-semibold">{title}</h2>
      {empty ? <div className="card px-6 py-10 text-center text-sm text-muted">—</div> : <div className="card overflow-hidden">{children}</div>}
    </section>
  );
}

function avg(value: number | null | undefined) {
  return value == null ? "—" : value.toFixed(1);
}

export default async function RatingsPage() {
  await requirePagePermission("ratings.view");
  const t = await getTranslations("ratingsOps");
  const ratings = await getTranslations("ratings");
  const locale = await getLocale();
  const [{ summary, staff }, recent, reasons] = await Promise.all([getRatingsOverview(), listRecentRatings(), listSurveyReasons()]);

  return (
    <>
      <PageHeader title={t("title")} />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label={t("total")} value={summary.total} />
        <Stat label={t("average")} value={avg(summary.average)} />
        <Stat label={t("low")} value={summary.low} />
        <Stat label={t("nps")} value={summary.nps == null ? "—" : summary.nps} hint={t("responses", { count: summary.responses })} />
      </div>

      <Section title={t("staff")} empty={staff.length === 0}>
        <div className={`${head} ${staffGrid}`}>
          <span>{t("columns.name")}</span>
          <span className="text-right">{t("columns.count")}</span>
          <span className="text-right">{t("columns.average")}</span>
          <span className="text-right">{t("columns.low")}</span>
          <span className="text-right">{t("columns.pickup")}</span>
          <span className="text-right">{t("columns.return")}</span>
          <span className="text-right">{t("columns.conversation")}</span>
        </div>
        <ul className="divide-y divide-ink/[0.06]">
          {staff.map((row) => (
            <li key={row.userId} className={`grid grid-cols-2 gap-x-4 gap-y-1 px-5 py-3.5 text-sm md:items-center ${staffGrid}`}>
              <span className="col-span-2 truncate font-medium md:col-span-1">{row.displayName}</span>
              <span className="text-[13px] tabular-nums text-charcoal md:text-right">{row.count}</span>
              <span className="text-right text-[13px] tabular-nums text-charcoal">{avg(row.average)}</span>
              <span className={cn("text-[13px] tabular-nums md:text-right", row.low ? "font-medium text-status-danger" : "text-charcoal")}>{row.low}</span>
              <span className="text-right text-[13px] tabular-nums text-charcoal">{avg(row.kinds.PICKUP)}</span>
              <span className="text-[13px] tabular-nums text-charcoal md:text-right">{avg(row.kinds.RETURN)}</span>
              <span className="text-right text-[13px] tabular-nums text-charcoal">{avg(row.kinds.CONVERSATION)}</span>
            </li>
          ))}
        </ul>
      </Section>

      <Section title={t("recent")} empty={recent.length === 0}>
        <div className={`${head} ${recentGrid}`}>
          <span>{t("columns.time")}</span>
          <span>{t("columns.kind")}</span>
          <span>{t("columns.score")}</span>
          <span>{t("columns.staff")}</span>
          <span>{t("columns.customer")}</span>
          <span>{t("columns.comment")}</span>
          <span className="text-right">{t("columns.source")}</span>
        </div>
        <ul className="divide-y divide-ink/[0.06]">
          {recent.map((rating) => {
            const href = rating.conversation_id ? `/inbox/${rating.conversation_id}` : rating.reservation_id ? `/reservations/${rating.reservation_id}` : null;
            const body = (
              <>
                <span className="text-[13px] text-muted">{formatDateTime(rating.created_at, locale)}</span>
                <span className="text-right text-[13px] text-charcoal md:text-left">{ratings(`kinds.${rating.kind}`)}</span>
                <Stars score={rating.score} />
                <span className="truncate text-right text-[13px] text-charcoal md:text-left">{rating.staffName ?? (rating.kind === "VEHICLE" || rating.kind === "TRIP" ? "—" : ratings("team"))}</span>
                <span className="truncate text-[13px] text-charcoal">{rating.customerName ?? "—"}</span>
                <span className={cn("col-span-2 truncate text-[13px] md:col-span-1", rating.score <= lowScoreMax ? "text-ink" : "text-charcoal")} title={rating.comment ?? undefined}>
                  {rating.comment || "—"}
                </span>
                <span className="col-span-2 text-right text-xs text-muted md:col-span-1">{t(`sources.${rating.source}`)}</span>
              </>
            );
            const className = `grid grid-cols-2 gap-x-4 gap-y-1 px-5 py-3.5 text-sm md:items-center ${recentGrid}`;
            return (
              <li key={rating.id}>
                {href ? (
                  <Link href={href} className={`${className} transition-colors hover:bg-gold/[0.04]`}>
                    {body}
                  </Link>
                ) : (
                  <div className={className}>{body}</div>
                )}
              </li>
            );
          })}
        </ul>
      </Section>

      <Section title={t("reasons")} empty={reasons.length === 0}>
        <ul className="divide-y divide-ink/[0.06]">
          {reasons.map((survey) => (
            <li key={survey.id}>
              <Link href={`/reservations/${survey.reservationId}`} className="flex items-start gap-4 px-5 py-3.5 text-sm transition-colors hover:bg-gold/[0.04]">
                <span
                  className={cn(
                    "flex size-8 shrink-0 items-center justify-center rounded-full text-[13px] font-semibold tabular-nums",
                    survey.score >= 9 ? "bg-status-available/12 text-status-available" : survey.score >= 7 ? "bg-ink/5 text-charcoal" : "bg-status-danger/10 text-status-danger",
                  )}
                >
                  {survey.score}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] text-ink">{survey.reason || "—"}</span>
                  <span className="mt-1 block text-xs text-muted">
                    {survey.reservationNumber ?? "—"}
                    {survey.completedAt && ` · ${formatDateTime(survey.completedAt, locale)}`}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </Section>
    </>
  );
}
