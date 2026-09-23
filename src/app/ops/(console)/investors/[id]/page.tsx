import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/Badge";
import { BackLink, safeBack, withBack } from "@/components/ops/BackLink";
import { PageHeader } from "@/components/ops/PageHeader";
import { currentTime, zonedParts } from "@/features/booking/time";
import { listBankAccounts, listWithdrawals, type Withdrawal } from "@/features/investor/banking";
import { listAllocations, listContributions, listVehicleOptions } from "@/features/investor/contributions";
import { DeleteDocumentButton, DocumentUploadForm } from "@/features/investor/DocumentForms";
import { documentKinds, listDocuments } from "@/features/investor/documents";
import { ExitStatusForm } from "@/features/investor/ExitForms";
import { listExitRequests } from "@/features/investor/exits";
import { PlaceHoldForm, ReleaseHoldForm } from "@/features/investor/HoldForms";
import { holdsAffecting, pendingEntryIds, type HoldMap } from "@/features/investor/holds";
import { listEntries, loadBalances, type LedgerEntry } from "@/features/investor/ledger";
import { investorNames, listAttachable, listCompanies, listMembers, listStakes, loadMemberPosition, percent, type CompanyOption, type MemberPosition, type MemberRow, type Stake } from "@/features/investor/members";
import { currentRate, listRates, listStatements, monthKey } from "@/features/investor/mileage";
import { getInvestor } from "@/features/investor/ops-queries";
import { AdjustmentForm, AllocationForm, BackfillForm, ConfirmCapitalForm, ConfirmVehicleForm, DeclineContributionForm, EndAllocationForm } from "@/features/investor/OpsFinanceForms";
import { ProfileForm, ResetEmailButton, ReviewForm, StatusForm } from "@/features/investor/OpsForms";
import { OpsLedger } from "@/features/investor/OpsLedger";
import { AddStakeForm, AttachMemberForm, VoidStakeButton } from "@/features/investor/OpsMemberForms";
import { RowAction } from "@/features/investor/RowAction";
import { MarkPaidForm, RevealAccountForm, ReviewBankRequestForm, ReviewWithdrawalForm } from "@/features/investor/OpsPayoutForms";
import { loadInvestorSettings } from "@/features/investor/settings";
import { backfillBatch, listBackfillRows, type BackfillRow } from "@/features/investor/share";
import { statusTone } from "@/features/investor/ui";
import { can, requirePagePermission } from "@/lib/auth/staff";
import { cn } from "@/lib/utils/cn";
import { formatDate, formatDateTime, formatMoney } from "@/lib/utils/format";

export const metadata: Metadata = { title: "Investor" };

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ back?: string; created?: string }> };

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const contributionTone: Record<string, "warning" | "success" | "danger" | "neutral"> = { REQUESTED: "warning", CONFIRMED: "success", DECLINED: "danger", CANCELLED: "neutral" };
const head = "hidden gap-3 border-b border-ink/[0.07] bg-pearl/60 px-4 py-2 text-[11px] font-medium tracking-[0.12em] text-muted uppercase md:grid";
const cell = "grid gap-x-3 gap-y-1 px-4 py-2.5 text-[13px] md:items-center";

function Section({ title, children, extra }: { title: string; children: ReactNode; extra?: ReactNode }) {
  return (
    <section className="card overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-4 py-3">
        <h2 className="text-sm font-semibold">{title}</h2>
        {extra}
      </div>
      {children}
    </section>
  );
}

function Expand({ label, children, open }: { label: string; children: ReactNode; open?: boolean }) {
  return (
    <details open={open} className="group border-t border-ink/[0.07]">
      <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-2.5 text-[13px] font-medium text-charcoal hover:bg-pearl/60">
        {label}
        <span className="text-muted transition-transform group-open:rotate-90">›</span>
      </summary>
      <div className="border-t border-ink/[0.06] px-4 py-4">{children}</div>
    </details>
  );
}

export default async function InvestorPage({ params, searchParams }: Props) {
  const session = await requirePagePermission("investor.view");
  const { id } = await params;
  const { back, created } = await searchParams;
  if (!uuid.test(id)) notFound();
  const manage = can(session, "investor.manage");
  const finance = can(session, "investor.finance");
  const early = Promise.all([loadBalances(id), listContributions(id), listAllocations(id), listEntries(id, { limit: 100 }), listVehicleOptions(), loadInvestorSettings(), listWithdrawals(id), listBankAccounts(id, true), listDocuments(id), listExitRequests(id), listRates(id), listStatements({ investorId: id, limit: 12 }), currentRate(id), pendingEntryIds(id), manage ? listCompanies() : Promise.resolve([] as CompanyOption[])]);
  early.catch(() => null);
  const [t, locale, investor] = await Promise.all([getTranslations("investors"), getLocale(), getInvestor(id)]);
  if (!investor) notFound();
  const [balances, contributions, allocations, entries, vehicles, settings, withdrawals, bankAccounts, documents, exits, rates, statements, rate, pending, companies] = await early;
  const companyId = investor.company_id;
  const isCompany = investor.kind === "COMPANY";
  const [holds, backfillRows, members, stakes, position, memberWithdrawals, memberEntries, names, attachable] = await Promise.all([
    companyId ? Promise.resolve<HoldMap>({ investor: null, vehicles: {}, entries: {} }) : holdsAffecting(investor.id, allocations.map((item) => item.vehicle_id), pending),
    !companyId && finance && investor.status !== "CLOSED" ? Promise.all(allocations.map(async (allocation) => [allocation.id, await listBackfillRows(allocation)] as const)) : Promise.resolve([] as Array<readonly [string, BackfillRow[]]>),
    isCompany ? listMembers(investor.id) : Promise.resolve([] as MemberRow[]),
    isCompany ? listStakes({ companyId: investor.id }) : companyId ? listStakes({ memberId: investor.id }) : Promise.resolve([] as Stake[]),
    companyId ? loadMemberPosition(investor.id, companyId) : Promise.resolve<MemberPosition | null>(null),
    companyId ? listWithdrawals(companyId, investor.id) : Promise.resolve([] as Withdrawal[]),
    companyId ? listEntries(companyId, { limit: 100, memberId: investor.id }) : Promise.resolve([] as LedgerEntry[]),
    investorNames([companyId, ...bankAccounts.flatMap((account) => [account.requested_by, account.removal_requested_by])]),
    isCompany && manage ? listAttachable() : Promise.resolve([] as CompanyOption[]),
  ]);
  const perMile = investor.compensation === "PER_MILE";
  const parent = companyId ? (names.get(companyId) ?? null) : null;
  const openExits = exits.filter((item) => item.status === "REQUESTED" || item.status === "IN_PROGRESS");
  const activeHolds = [holds.investor, ...Object.values(holds.vehicles)].filter(Boolean);
  const backfill: Record<string, BackfillRow[]> = Object.fromEntries(backfillRows);
  const now = currentTime();
  const today = zonedParts(new Date(now), "America/Los_Angeles").date;
  const className = (allocation: (typeof allocations)[number]) => (locale === "zh" ? (allocation.vehicle?.vehicle_class?.name_zh ?? allocation.vehicle?.vehicle_class?.name) : allocation.vehicle?.vehicle_class?.name) ?? "";
  const figures = position ?? balances;
  const stats = [
    { label: t("stats.available"), value: formatMoney(figures.availableCents) },
    { label: t("stats.pending"), value: formatMoney(figures.pendingCents) },
    { label: t("stats.held"), value: formatMoney(figures.heldCents) },
    { label: t("stats.invested"), value: formatMoney(figures.investedCents) },
    { label: t("stats.withdrawn"), value: formatMoney(figures.withdrawnCents) },
  ];
  const untouched = contributions.length + allocations.length + entries.length + withdrawals.length + bankAccounts.length === 0;
  const joinable = companyId || (!isCompany && untouched) ? companies.filter((item) => item.id !== investor.id) : [];
  const companyOptions = parent && !joinable.some((item) => item.id === parent.id) ? [parent, ...joinable] : joinable;
  const memberNames = new Map(members.map((member) => [member.id, member]));
  const canAddMember = manage && isCompany && !perMile && ["PENDING", "ACTIVE", "SUSPENDED"].includes(investor.status);
  const payoutRows = companyId ? memberWithdrawals : withdrawals;
  const bankRequest = (account: (typeof bankAccounts)[number]) => (account.removed_at ? null : account.status === "PENDING" ? ("add" as const) : account.status === "ACTIVE" && account.removal_requested_at ? ("remove" as const) : null);
  const bankRequests = bankAccounts.filter((account) => bankRequest(account)).length;
  const contributionGrid = "md:grid-cols-[5.5rem_4rem_minmax(0,1fr)_5.5rem_4rem]";
  const allocationGrid = "md:grid-cols-[minmax(0,1.4fr)_4.5rem_6.5rem_4rem_minmax(0,1fr)_7rem_4.5rem]";
  const withdrawalGrid = companyId ? "md:grid-cols-[5.5rem_5.5rem_minmax(0,1fr)_5.5rem]" : "md:grid-cols-[5.5rem_5.5rem_minmax(0,1fr)_5.5rem_4rem]";
  const documentGrid = "md:grid-cols-[4.5rem_minmax(0,1fr)_5rem_5.5rem_5.5rem]";
  const statementGrid = "md:grid-cols-[6rem_minmax(0,1fr)_6rem_6rem_7rem_6rem]";
  const memberGrid = "md:grid-cols-[minmax(0,1.4fr)_7rem_6.5rem_7rem_5rem_7rem]";
  const stakeGrid = isCompany ? "md:grid-cols-[5.5rem_minmax(0,1fr)_6.5rem_4rem]" : "md:grid-cols-[5.5rem_minmax(0,1fr)_4rem]";
  const statementTone: Record<string, "warning" | "info" | "danger" | "success" | "neutral"> = { DRAFT: "warning", ISSUED: "info", DISPUTED: "danger", SETTLED: "success", VOID: "neutral" };

  return (
    <>
      <BackLink href={safeBack(back, "/investors")} />
      <PageHeader eyebrow={investor.investor_number} title={investor.legal_name} actions={
          <span className="flex flex-wrap items-center gap-2">
            {parent && (
              <Link href={`/investors/${parent.id}`} className="text-[13px] font-medium hover:text-gold">
                {parent.legal_name} · {parent.investor_number}
              </Link>
            )}
            {position && (
              <span className="text-[13px] tabular-nums text-muted">
                {t("company.stake")} {formatMoney(position.stakeCents)} · {t("company.ratio")} {percent(position.ratio)}
              </span>
            )}
            {isCompany && <Badge tone="info">{t("company.kinds.COMPANY")}</Badge>}
            {investor.house && <Badge tone="gold">{t("fields.house")}</Badge>}
            <Badge tone={statusTone[investor.status]}>{t(`status.${investor.status}`)}</Badge>
          </span>
        }
      />
      {created && investor.email && <p className="mb-4 rounded-xl bg-status-available/10 px-4 py-3 text-[13px]">{t("createdNotice")}</p>}
      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-5">
        {stats.map((item) => (
          <div key={item.label} className="card px-4 py-3">
            <p className="text-xs text-muted">{item.label}</p>
            <p className="mt-0.5 text-lg font-semibold tabular-nums">{item.value}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Section title={t("profile")}>
          <dl className="grid grid-cols-[6rem_minmax(0,1fr)] gap-y-1.5 border-t border-ink/[0.07] px-4 py-3 text-[13px]">
            <dt className="text-muted">{t("fields.email")}</dt>
            <dd className="truncate">{investor.email ?? "—"}</dd>
            <dt className="text-muted">{t("fields.phone")}</dt>
            <dd>{investor.phone ?? "—"}</dd>
            <dt className="text-muted">{t("fields.language")}</dt>
            <dd>{investor.preferred_language === "en" ? "English" : "中文"}</dd>
            {!companyId && (
              <>
                <dt className="text-muted">{t("fields.compensation")}</dt>
                <dd>{t(`compensation.${investor.compensation}`)}</dd>
                {perMile ? (
                  <>
                    <dt className="text-muted">{t("mileage.rate")}</dt>
                    <dd>{formatMoney(rate)}{t("mileage.perMile")}</dd>
                    <dt className="text-muted">{t("mileage.payoutDays")}</dt>
                    <dd>{investor.mileage_payout_days ?? settings.mileagePayoutDays}</dd>
                  </>
                ) : (
                  <>
                    <dt className="text-muted">{t("fields.defaultShare")}</dt>
                    <dd>{(investor.default_share_bps ?? settings.revenueShareBps) / 100}%</dd>
                  </>
                )}
              </>
            )}
            <dt className="text-muted">{t("fields.notes")}</dt>
            <dd className="whitespace-pre-line">{investor.notes || "—"}</dd>
          </dl>
          {manage && (
            <Expand label={t("editProfile")}>
              <ProfileForm investor={investor} rateCents={rate} month={today.slice(0, 7)} companies={companyOptions} blocked={!companyId && !isCompany && !untouched} />
            </Expand>
          )}
          {perMile && rates.length > 0 && (
            <Expand label={t("mileage.rateHistory")}>
              <ul className="divide-y divide-ink/[0.06] text-[13px]">
                {rates.map((item) => (
                  <li key={item.id} className="flex items-center justify-between gap-3 py-2">
                    <span className="text-muted">{item.effective_month.slice(0, 7)}</span>
                    <span className="font-medium tabular-nums">{formatMoney(item.rate_cents)}{t("mileage.perMile")}</span>
                  </li>
                ))}
              </ul>
            </Expand>
          )}
        </Section>
        <Section title={t("account")}>
          <dl className="grid grid-cols-[6rem_minmax(0,1fr)] gap-y-1.5 border-t border-ink/[0.07] px-4 py-3 text-[13px]">
            <dt className="text-muted">{t("fields.created")}</dt>
            <dd>{formatDateTime(investor.created_at)}</dd>
            {investor.reviewed_at && (
              <>
                <dt className="text-muted">{t("fields.reviewed")}</dt>
                <dd>
                  {formatDateTime(investor.reviewed_at)}
                  {investor.reviewer?.display_name ? ` · ${investor.reviewer.display_name}` : ""}
                </dd>
              </>
            )}
            {investor.review_note && (
              <>
                <dt className="text-muted">{t("fields.reviewNoteLabel")}</dt>
                <dd className="whitespace-pre-line">{investor.review_note}</dd>
              </>
            )}
          </dl>
          {investor.status === "PENDING" && manage && (
            <div className="border-t border-ink/[0.07] px-4 py-4">
              <ReviewForm id={investor.id} />
            </div>
          )}
          {manage && (
            <div className="flex flex-col gap-3 border-t border-ink/[0.07] px-4 py-4">
              <StatusForm id={investor.id} status={investor.status} />
              {investor.status === "ACTIVE" && investor.email && investor.auth_user_id && <ResetEmailButton id={investor.id} />}
            </div>
          )}
        </Section>
      </div>

      <div className="mt-5 flex flex-col gap-5">
        {isCompany && (members.length > 0 || canAddMember) && (
          <Section
            title={`${t("company.members")} · ${members.length}`}
            extra={
              canAddMember && (
                <Link href={`/investors/new?company=${investor.id}`} className="text-[12px] text-muted hover:text-ink">
                  {t("company.addMember")} →
                </Link>
              )
            }
          >
            {members.length === 0 ? (
              <p className="border-t border-ink/[0.07] px-4 py-4 text-[13px] text-muted">{t("company.none")}</p>
            ) : (
              <>
                <div className={cn(head, memberGrid)}>
                  <span>{t("columns.name")}</span>
                  <span>{t("columns.number")}</span>
                  <span>{t("columns.status")}</span>
                  <span className="text-right">{t("company.stake")}</span>
                  <span className="text-right">{t("company.ratio")}</span>
                  <span className="text-right">{t("stats.available")}</span>
                </div>
                <ul className="divide-y divide-ink/[0.06]">
                  {members.map((member) => (
                    <li key={member.id} className={cn(cell, memberGrid)}>
                      <Link href={withBack(`/investors/${member.id}`, `/investors/${investor.id}`)} className="truncate font-medium hover:text-gold">
                        {member.legal_name}
                      </Link>
                      <span className="font-mono text-[12px] text-muted">{member.investor_number}</span>
                      <span>
                        <Badge tone={statusTone[member.status]}>{t(`status.${member.status}`)}</Badge>
                      </span>
                      <span className="tabular-nums md:text-right">{formatMoney(member.stakeCents)}</span>
                      <span className="tabular-nums md:text-right">{percent(member.ratio)}</span>
                      <span className="font-semibold tabular-nums md:text-right">{formatMoney(member.availableCents)}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
            {canAddMember && attachable.length > 0 && (
              <Expand label={t("company.attachExisting")}>
                <AttachMemberForm companyId={investor.id} candidates={attachable.map((item) => ({ id: item.id, label: `${item.legal_name} · ${item.investor_number}` }))} today={today} />
              </Expand>
            )}
          </Section>
        )}

        {!companyId && (
          <>
            <Section title={t("allocations.title")}>
              {allocations.length === 0 ? (
                <p className="border-t border-ink/[0.07] px-4 py-4 text-[13px] text-muted">{t("allocations.empty")}</p>
              ) : (
                <>
                  <div className={cn(head, allocationGrid)}>
                    <span>{t("columns.vehicle")}</span>
                    <span>{t("columns.kind")}</span>
                    <span>{t("columns.capital")}</span>
                    <span>{t("columns.share")}</span>
                    <span>{t("columns.period")}</span>
                    <span>{t("columns.status")}</span>
                    <span>{t("columns.actions")}</span>
                  </div>
                  <ul className="divide-y divide-ink/[0.06]">
                    {allocations.map((allocation) => {
                      const exit = openExits.find((item) => item.allocation_id === allocation.id);
                      const due = backfill[allocation.id] ?? [];
                      return (
                        <li key={allocation.id} className={cn(cell, allocationGrid, allocation.status === "ENDED" && "opacity-60")}>
                          <Link href={withBack(`/fleet/${allocation.vehicle_id}`, `/investors/${investor.id}`)} className="truncate font-medium hover:text-gold">
                            {allocation.vehicle?.fleet_number} · {className(allocation)}
                          </Link>
                          <span>
                            <Badge tone={allocation.source === "CAPITAL" ? "gold" : "info"}>{t(`contributions.kind.${allocation.source}`)}</Badge>
                          </span>
                          <span className="tabular-nums">{allocation.source === "CAPITAL" ? formatMoney(allocation.cost_basis_cents) : "—"}</span>
                          <span>{perMile ? `${formatMoney(rate)}${t("mileage.perMile")}` : `${allocation.revenue_share_bps / 100}%`}</span>
                          <span className="text-muted">
                            {allocation.effective_from}
                            {allocation.effective_to ? ` → ${allocation.effective_to}` : ""}
                          </span>
                          <span className="flex flex-col items-start gap-1">
                            <Badge tone={allocation.status === "ACTIVE" ? "success" : allocation.status === "EXITING" ? "warning" : "neutral"}>{t(`allocations.status.${allocation.status}`)}</Badge>
                            {exit && <Badge tone="warning">{t(`exits.status.${exit.status}`)}</Badge>}
                            {due.length > 0 && <Badge tone="gold">{t("finance.backfillTag", { count: due.length })}</Badge>}
                          </span>
                          {exit || due.length > 0 || (finance && allocation.status !== "ENDED") ? (
                              <RowAction label={t("handle")}>
                                <div className="flex flex-col gap-3">
                                  {exit && (
                                    <div className="text-[13px]">
                                      <p className="mb-2 text-charcoal">
                                        {t("exits.title")} · {formatDateTime(exit.created_at)}
                                        {exit.reason ? ` · ${exit.reason}` : ""}
                                      </p>
                                      {manage && <ExitStatusForm id={exit.id} />}
                                      <p className="mt-2 text-[12px] text-muted">{t("exits.hint")}</p>
                                    </div>
                                  )}
                                  {due.length > 0 && <BackfillForm id={allocation.id} rows={due.slice(0, backfillBatch).map((row) => ({ number: row.number, date: row.date, amountCents: row.amountCents }))} />}
                                  {finance && allocation.status !== "ENDED" && <EndAllocationForm id={allocation.id} costBasisCents={allocation.cost_basis_cents} today={today} />}
                                </div>
                              </RowAction>
                            ) : (
                              <span />
                            )}
                        </li>
                      );
                    })}
                  </ul>
                </>
              )}
              {manage && investor.status === "ACTIVE" && (
                <Expand label={t("allocations.new")}>
                  <AllocationForm investorId={investor.id} vehicles={vehicles} defaultShare={(investor.default_share_bps ?? settings.revenueShareBps) / 100} today={today} availableCents={balances.availableCents} perMile={perMile} />
                </Expand>
              )}
            </Section>

            {(perMile || statements.length > 0) && (
              <Section
                title={t("mileage.title")}
                extra={
                  <Link href={withBack("/investors/mileage", `/investors/${investor.id}`)} className="text-[12px] text-muted hover:text-ink">
                    {t("holds.all")} →
                  </Link>
                }
              >
                {statements.length === 0 ? (
                  <p className="border-t border-ink/[0.07] px-4 py-4 text-[13px] text-muted">{t("mileage.none")}</p>
                ) : (
                  <>
                    <div className={cn(head, statementGrid)}>
                      <span>{t("columns.period")}</span>
                      <span>{t("columns.vehicle")}</span>
                      <span className="text-right">{t("mileage.columns.miles")}</span>
                      <span className="text-right">{t("mileage.columns.rate")}</span>
                      <span className="text-right">{t("columns.amount")}</span>
                      <span>{t("columns.status")}</span>
                    </div>
                    <ul className="divide-y divide-ink/[0.06]">
                      {statements.map((item) => (
                        <li key={item.id} className={cn(cell, statementGrid)}>
                          <Link href={withBack(`/investors/mileage?month=${monthKey(item)}`, `/investors/${investor.id}`)} className="font-medium hover:text-gold">
                            {monthKey(item)}
                          </Link>
                          <span className="truncate">
                            {item.vehicle?.fleet_number}
                            {item.final ? ` · ${t("mileage.final")}` : ""}
                          </span>
                          <span className="text-right tabular-nums">{item.qualifying_miles.toLocaleString("en-US")}</span>
                          <span className="text-right tabular-nums text-muted">{formatMoney(item.rate_cents)}</span>
                          <span className="text-right font-semibold tabular-nums">{formatMoney(item.amount_cents)}</span>
                          <span>
                            <Badge tone={statementTone[item.status]}>{t(`mileage.status.${item.status}`)}</Badge>
                          </span>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </Section>
            )}
          </>
        )}

        <div className="grid gap-5 xl:grid-cols-2 xl:[&>*:last-child:nth-child(odd)]:col-span-2">
          {(companyId || (isCompany && (members.length > 0 || stakes.length > 0))) && (
            <Section title={`${t("company.stakes")} · ${stakes.filter((stake) => !stake.voided_at).length}`}>
              {stakes.length === 0 ? (
                <p className="border-t border-ink/[0.07] px-4 py-4 text-[13px] text-muted">{t("company.none")}</p>
              ) : (
                <>
                  <div className={cn(head, stakeGrid)}>
                    <span>{t("columns.date")}</span>
                    {isCompany && <span>{t("company.member")}</span>}
                    <span>{t("columns.amount")}</span>
                    <span>{t("columns.actions")}</span>
                  </div>
                  <ul className="divide-y divide-ink/[0.06]">
                    {stakes.map((stake) => (
                      <li key={stake.id} className={cn(cell, stakeGrid, stake.voided_at && "opacity-60")}>
                        <span className="text-muted">{stake.effective_on}</span>
                        {isCompany && (
                          <span className="min-w-0">
                            {memberNames.has(stake.member_id) ? (
                              <Link href={withBack(`/investors/${stake.member_id}`, `/investors/${investor.id}`)} className="block truncate font-medium hover:text-gold">
                                {memberNames.get(stake.member_id)?.legal_name}
                              </Link>
                            ) : (
                              <span className="text-muted">—</span>
                            )}
                            {stake.note && <span className="block truncate text-[12px] text-muted">{stake.note}</span>}
                          </span>
                        )}
                        <span className="min-w-0">
                          <span className={cn("font-semibold tabular-nums", stake.amount_cents < 0 && "text-status-danger")}>{formatMoney(stake.amount_cents)}</span>
                          {!isCompany && stake.note && <span className="ml-2 text-[12px] text-muted">{stake.note}</span>}
                        </span>
                        {stake.voided_at ? (
                          <span>
                            <Badge tone="neutral">{t("company.voided")}</Badge>
                          </span>
                        ) : manage ? (
                          <VoidStakeButton id={stake.id} />
                        ) : (
                          <span />
                        )}
                      </li>
                    ))}
                  </ul>
                </>
              )}
              {manage && (companyId || members.length > 0) && (
                <Expand label={t("company.addStake")}>
                  {companyId ? <AddStakeForm memberId={investor.id} today={today} /> : <AddStakeForm members={members.filter((member) => member.status !== "CLOSED" && member.status !== "REJECTED").map((member) => ({ id: member.id, label: `${member.legal_name} · ${member.investor_number}` }))} today={today} />}
                </Expand>
              )}
            </Section>
          )}

          {!companyId && (
            <Section title={t("contributions.title")}>
              {contributions.length === 0 ? (
                <p className="border-t border-ink/[0.07] px-4 py-4 text-[13px] text-muted">{t("contributions.empty")}</p>
              ) : (
                <>
                  <div className={cn(head, contributionGrid)}>
                    <span>{t("columns.date")}</span>
                    <span>{t("columns.kind")}</span>
                    <span>{t("columns.detail")}</span>
                    <span>{t("columns.status")}</span>
                    <span>{t("columns.actions")}</span>
                  </div>
                  <ul className="divide-y divide-ink/[0.06]">
                    {contributions.map((item) => (
                      <li key={item.id} className={cn(cell, contributionGrid)}>
                        <span className="text-muted">{formatDate(item.created_at)}</span>
                        <span>
                          <Badge tone={item.kind === "CAPITAL" ? "gold" : "info"}>{t(`contributions.kind.${item.kind}`)}</Badge>
                        </span>
                        <span className="min-w-0 truncate">
                          {item.kind === "CAPITAL" ? (
                            <span className="font-medium tabular-nums">
                              {formatMoney(item.amount_cents)}
                              {item.received_cents !== null && item.received_cents !== item.amount_cents ? ` → ${formatMoney(item.received_cents)}` : ""}
                            </span>
                          ) : (
                            <span className="font-medium">
                              {item.vehicle_payload.year} {item.vehicle_payload.model} · {item.vehicle_payload.vin}
                            </span>
                          )}
                          {item.bank_reference && <span className="text-muted"> · {item.bank_reference}</span>}
                          {item.note && <span className="text-muted"> · {item.note}</span>}
                          {item.decision_note && <span className="text-muted"> · {item.decision_note}</span>}
                        </span>
                        <span>
                          <Badge tone={contributionTone[item.status]}>{t(`contributions.status.${item.status}`)}</Badge>
                        </span>
                        {item.status === "REQUESTED" && (item.kind === "CAPITAL" ? finance || manage : manage) ? (
                            <RowAction label={t("handle")}>
                              <div className="flex flex-col gap-3">
                                {item.kind === "CAPITAL" ? (
                                  finance ? <ConfirmCapitalForm id={item.id} amount={item.amount_cents} /> : <span className="text-[12px] text-muted">{t("contributions.needsFinance")}</span>
                                ) : (
                                  <ConfirmVehicleForm id={item.id} investorId={investor.id} vehicles={vehicles} defaultShare={(investor.default_share_bps ?? settings.revenueShareBps) / 100} today={today} perMile={perMile} odometer={item.vehicle_payload.mileage} />
                                )}
                                {manage && <DeclineContributionForm id={item.id} />}
                              </div>
                            </RowAction>
                          ) : (
                            <span />
                          )}
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </Section>
          )}

          <Section
            title={t("payouts.title")}
            extra={
              parent ? (
                <Link href={`/investors/${parent.id}`} className="text-[12px] text-muted hover:text-ink">
                  {t("company.decide")} →
                </Link>
              ) : (
                bankRequests > 0 && <Badge tone="warning">{`${t("pendingStrip.bank")} · ${bankRequests}`}</Badge>
              )
            }
          >
            {payoutRows.length === 0 ? (
              <p className="border-t border-ink/[0.07] px-4 py-4 text-[13px] text-muted">{t("payouts.empty")}</p>
            ) : (
              <>
                <div className={cn(head, withdrawalGrid)}>
                  <span>{t("columns.date")}</span>
                  <span>{t("columns.amount")}</span>
                  <span>{t("payouts.accounts")}</span>
                  <span>{t("columns.status")}</span>
                  {!companyId && <span>{t("columns.actions")}</span>}
                </div>
                <ul className="divide-y divide-ink/[0.06]">
                  {payoutRows.map((item) => {
                    const awaiting = item.status === "REQUESTED" && item.approval_id && item.approval?.status === "PENDING";
                    return (
                      <li key={item.id} className={cn(cell, withdrawalGrid)}>
                        <span className="text-muted">{formatDate(item.created_at)}</span>
                        <span className="font-semibold tabular-nums">{formatMoney(item.amount_cents)}</span>
                        <span className="truncate text-charcoal">
                          {!companyId && item.member && (
                            <>
                              <Link href={withBack(`/investors/${item.member.id}`, `/investors/${investor.id}`)} className="font-medium text-ink hover:text-gold">
                                {item.member.legal_name}
                              </Link>
                              {" · "}
                            </>
                          )}
                          {item.bank_account?.bank_name} •••• {item.bank_account?.last4}
                          {item.paid_reference ? ` · ${item.paid_reference}` : ""}
                          {item.decision_note && item.decision_note !== "cancelled_by_investor" ? ` · ${item.decision_note}` : ""}
                        </span>
                        <span className="flex flex-col items-start gap-1">
                          <Badge tone={item.status === "PAID" ? "success" : item.status === "APPROVED" ? "info" : item.status === "REQUESTED" ? "warning" : "neutral"}>{t(`payouts.status.${item.status}`)}</Badge>
                          {awaiting && <Badge tone="gold">{t("payouts.awaitingSecond")}</Badge>}
                        </span>
                        {companyId ? null : finance && ((item.status === "REQUESTED" && !awaiting) || item.status === "APPROVED") ? (
                          <RowAction label={t("handle")}>{item.status === "REQUESTED" ? <ReviewWithdrawalForm id={item.id} /> : <MarkPaidForm id={item.id} />}</RowAction>
                        ) : (
                          <span />
                        )}
                      </li>
                    );
                  })}
                </ul>
              </>
            )}
            {!companyId && (
              <Expand label={`${t("payouts.accounts")} · ${bankAccounts.filter((account) => !account.removed_at).length}`} open={bankRequests > 0}>
                {bankAccounts.length === 0 ? (
                  <p className="text-[13px] text-muted">{t("payouts.noAccounts")}</p>
                ) : (
                  <ul className="divide-y divide-ink/[0.06] text-[13px]">
                    {bankAccounts.map((account) => {
                      const request = bankRequest(account);
                      const asker = names.get((request === "add" ? account.requested_by : request === "remove" ? account.removal_requested_by : null) ?? "");
                      return (
                        <li key={account.id} className={cn("flex flex-wrap items-center gap-x-4 gap-y-1 py-2", account.removed_at && "opacity-50")}>
                          <span className="font-medium">
                            {account.bank_name} •••• {account.last4}
                          </span>
                          <span className="text-muted">
                            {account.holder_name} · {t(`payouts.types.${account.account_type}`)}
                          </span>
                          {account.status === "DECLINED" ? (
                            <Badge tone="danger">{t("company.bank.status.DECLINED")}</Badge>
                          ) : account.removed_at ? (
                            <Badge tone="neutral">{t("payouts.removed")}</Badge>
                          ) : (
                            <>
                              {(isCompany || account.status !== "ACTIVE") && <Badge tone={account.status === "PENDING" ? "warning" : "success"}>{t(`company.bank.status.${account.status}`)}</Badge>}
                              {account.status === "ACTIVE" && Date.parse(account.usable_after) > now && <Badge tone="warning">{t("payouts.cooling", { date: formatDateTime(account.usable_after) })}</Badge>}
                            </>
                          )}
                          {request === "remove" && <Badge tone="warning">{t("company.bank.removal")}</Badge>}
                          {asker && <span className="text-muted">{t("company.by", { name: asker.legal_name })}</span>}
                          {finance && !account.removed_at && <RevealAccountForm id={account.id} />}
                          {finance && request && <ReviewBankRequestForm id={account.id} request={request} />}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </Expand>
            )}
          </Section>

          {!companyId && (
            <Section
              title={`${t("holds.title")} · ${activeHolds.length}`}
              extra={
                <Link href="/investors/holds" className="text-[12px] text-muted hover:text-ink">
                  {t("holds.all")} →
                </Link>
              }
            >
              {activeHolds.length > 0 && (
                <ul className="divide-y divide-ink/[0.06] border-t border-ink/[0.07] text-[13px]">
                  {activeHolds.map(
                    (hold) =>
                      hold && (
                        <li key={hold.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
                          <span>
                            <Badge tone="warning">{t(`holds.scopes.${hold.scope}`)}</Badge>
                            {hold.vehicle && <span className="ml-2 font-medium">{hold.vehicle.fleet_number}</span>}
                            <span className="ml-2 text-charcoal">{hold.reason}</span>
                            <span className="ml-2 text-[12px] text-muted">{formatDateTime(hold.created_at)}</span>
                          </span>
                          {manage && <ReleaseHoldForm id={hold.id} />}
                        </li>
                      ),
                  )}
                </ul>
              )}
              {manage && !holds.investor && investor.status === "ACTIVE" && (
                <Expand label={t("holds.place")}>
                  <PlaceHoldForm scope="INVESTOR" target={investor.id} />
                </Expand>
              )}
            </Section>
          )}

          <Section title={`${t("documents.title")} · ${documents.length}`}>
            {documents.length > 0 && (
              <>
                <div className={cn(head, documentGrid)}>
                  <span>{t("columns.kind")}</span>
                  <span>{t("documents.titleField")}</span>
                  <span>{t("documents.allocation")}</span>
                  <span>{t("columns.date")}</span>
                  <span>{t("columns.actions")}</span>
                </div>
                <ul className="divide-y divide-ink/[0.06]">
                  {documents.map((item) => (
                    <li key={item.id} className={cn(cell, documentGrid)}>
                      <span>
                        <Badge tone={item.kind === "AGREEMENT" ? "gold" : "neutral"}>{t(`documents.kinds.${item.kind}`)}</Badge>
                      </span>
                      <a href={`/investors/documents/${item.id}`} target="_blank" rel="noreferrer" className="truncate font-medium hover:text-gold">
                        {item.title}
                      </a>
                      <span className="text-muted">{item.allocation?.vehicle?.fleet_number ?? t("documents.allAssets")}</span>
                      <span className="text-muted">{item.signed_on ?? formatDate(item.created_at)}</span>
                      <span className="flex items-center gap-3">
                        <a href={`/investors/documents/${item.id}?download=1`} className="text-[12px] text-gold hover:text-gold-light">
                          {t("documents.download")}
                        </a>
                        {manage && <DeleteDocumentButton id={item.id} />}
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            )}
            {manage && (
              <Expand label={t("documents.upload")}>
                <DocumentUploadForm investorId={investor.id} kinds={[...documentKinds]} allocations={allocations.map((item) => ({ id: item.id, label: `${item.vehicle?.fleet_number ?? ""} · ${className(item)}` }))} />
              </Expand>
            )}
          </Section>
        </div>

        <Section title={t("ledger.title")}>
          <div className="border-t border-ink/[0.07] px-4 py-3">{companyId ? <OpsLedger entries={memberEntries} readOnly /> : <OpsLedger entries={entries} canReverse={finance} canHold={manage} holds={holds} />}</div>
          {!companyId && finance && investor.status !== "CLOSED" && (
            <Expand label={t("ledger.adjust")}>
              <AdjustmentForm investorId={investor.id} vehicles={vehicles.filter((vehicle) => allocations.some((allocation) => allocation.vehicle_id === vehicle.id))} />
            </Expand>
          )}
        </Section>
      </div>
    </>
  );
}
