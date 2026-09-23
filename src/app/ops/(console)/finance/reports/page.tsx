import type { Metadata } from "next";
import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Input, Select } from "@/components/ui/Field";
import { PageHeader } from "@/components/ops/PageHeader";
import { LedgerStatus, LedgerTabs } from "@/features/finance/ledger/LedgerChrome";
import { VOUCHER_PAGE, loadAccounts, loadVouchers, pickDate } from "@/features/finance/ledger/views";
import { requirePagePermission } from "@/lib/auth/staff";
import { cn } from "@/lib/utils/cn";
import { formatMoney } from "@/lib/utils/format";

export const metadata: Metadata = { title: "Ledger" };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

const sources = ["reservation", "stripe_txn", "stripe_payout", "stripe_dispute", "payment", "refund", "investor_ledger", "expense", "resolution", "settlement"] as const;
const text = (value: string | string[] | undefined) => (typeof value === "string" ? value.trim() : "");
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function VouchersPage({ searchParams }: Props) {
  await requirePagePermission("finance.view");
  const search = await searchParams;
  const source = sources.find((value) => value === text(search.source)) ?? null;
  const account = /^\d{4}$/.test(text(search.account)) ? text(search.account) : null;
  const vehicle = uuid.test(text(search.vehicle)) ? text(search.vehicle).toLowerCase() : null;
  const economic = text(search.basis) === "economic";
  const filter = { from: pickDate(search.from), to: pickDate(search.to), source, order: text(search.order) || null, account, vehicle, economic, page: Math.max(0, Math.floor(Number(text(search.page)) || 0)) };
  const [t, locale, accounts, data] = await Promise.all([getTranslations("finance.ledger"), getLocale(), loadAccounts(), loadVouchers(filter)]);
  const nameOf = (code: string) => {
    const row = accounts.get(code);
    return row ? (locale === "zh" ? row.name_zh : row.name_en) : code;
  };
  const pages = Math.max(1, Math.ceil(data.total / VOUCHER_PAGE));
  const params = (page: number, drop?: "vehicle" | "basis") => {
    const query = new URLSearchParams();
    if (filter.economic && drop !== "basis") query.set("basis", "economic");
    if (filter.vehicle && drop !== "vehicle") query.set("vehicle", filter.vehicle);
    if (filter.from) query.set("from", filter.from);
    if (filter.to) query.set("to", filter.to);
    if (filter.source) query.set("source", filter.source);
    if (filter.order) query.set("order", filter.order);
    if (filter.account) query.set("account", filter.account);
    if (page > 0) query.set("page", String(page));
    const value = query.toString();
    return value ? `/finance/reports?${value}` : "/finance/reports";
  };
  const grid = "grid min-w-[44rem] grid-cols-[5rem_6.5rem_minmax(0,1fr)_6rem_7rem] gap-4 px-5";
  const lineGrid = "grid min-w-[40rem] grid-cols-[minmax(0,1.3fr)_6rem_6rem_minmax(0,1.2fr)] gap-3";

  return (
    <>
      <PageHeader title={t("titles.reports")} actions={<LedgerStatus />} />
      <LedgerTabs group="reports" current="vouchers" />
      <form className="mb-5 flex flex-wrap items-end gap-3">
        {filter.economic && <input type="hidden" name="basis" value="economic" />}
        {filter.vehicle && <input type="hidden" name="vehicle" value={filter.vehicle} />}
        <label className="flex flex-col gap-1 text-[12px] text-muted">
          {t("filter.from")}
          <Input type="date" name="from" defaultValue={filter.from ?? ""} className="h-9 w-40" />
        </label>
        <label className="flex flex-col gap-1 text-[12px] text-muted">
          {t("filter.to")}
          <Input type="date" name="to" defaultValue={filter.to ?? ""} className="h-9 w-40" />
        </label>
        <label className="flex flex-col gap-1 text-[12px] text-muted">
          {t("filter.source")}
          <Select name="source" defaultValue={filter.source ?? ""} className="h-9 w-40">
            <option value="">{t("filter.all")}</option>
            {sources.map((value) => (
              <option key={value} value={value}>
                {t(`sources.${value}`)}
              </option>
            ))}
          </Select>
        </label>
        <label className="flex flex-col gap-1 text-[12px] text-muted">
          {t("filter.order")}
          <Input name="order" defaultValue={filter.order ?? ""} placeholder="MV-" className="h-9 w-36" />
        </label>
        <label className="flex flex-col gap-1 text-[12px] text-muted">
          {t("filter.account")}
          <Input name="account" defaultValue={filter.account ?? ""} inputMode="numeric" className="h-9 w-24" />
        </label>
        <Button type="submit" size="sm" variant="secondary">
          {t("filter.apply")}
        </Button>
        {filter.economic && (
          <Link href={params(0, "basis")} className="self-center">
            <Badge>{t("filter.economic")} ×</Badge>
          </Link>
        )}
        {filter.vehicle && (
          <Link href={params(0, "vehicle")} className="self-center">
            <Badge>{t("filter.vehicle")} ×</Badge>
          </Link>
        )}
      </form>
      <section className="card overflow-x-auto">
        <div className={cn(grid, "border-b border-ink/[0.07] bg-pearl/60 py-2.5 text-[11px] font-medium tracking-[0.12em] text-muted uppercase")}>
          <span>{t("columns.no")}</span>
          <span>{t("columns.date")}</span>
          <span>{t("columns.source")}</span>
          <span>{t("columns.reason")}</span>
          <span className="text-right">{t("columns.amount")}</span>
        </div>
        {data.rows.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-muted">{t("empty")}</p>
        ) : (
          <ul className="divide-y divide-ink/[0.06]">
            {data.rows.map((row) => {
              const amount = row.lines.reduce((sum, line) => sum + line.debit_cents, 0);
              return (
                <li key={row.id}>
                  <details>
                    <summary className={cn(grid, "cursor-pointer list-none py-2.5 text-[13px] hover:bg-pearl/40")}>
                      <span className="tabular-nums">{row.entry_no}</span>
                      <span className="tabular-nums">
                        {filter.economic ? row.economic_date : row.entry_date}
                        {row.adjusts_period && <span className="ml-1 text-[11px] text-muted">{t("adjusts", { period: row.adjusts_period })}</span>}
                      </span>
                      <span className="min-w-0 truncate">
                        {t(`sources.${row.source_type}`)}
                        <span className="ml-2 text-[11px] text-muted">{row.source_key}</span>
                      </span>
                      <span>
                        <Badge tone={row.reason === "NEW" ? "neutral" : "info"}>{t(`reasons.${row.reason}`)}</Badge>
                      </span>
                      <span className="text-right tabular-nums">{formatMoney(amount)}</span>
                    </summary>
                    <div className="overflow-x-auto bg-pearl/30 px-5 py-3">
                      <div className={cn(lineGrid, "pb-1.5 text-[11px] text-muted")}>
                        <span>{t("columns.account")}</span>
                        <span className="text-right">{t("columns.debit")}</span>
                        <span className="text-right">{t("columns.credit")}</span>
                        <span>{t("columns.tags")}</span>
                      </div>
                      {row.lines.map((line) => (
                        <div key={line.line_no} className={cn(lineGrid, "py-1 text-[12px]")}>
                          <span className="min-w-0 truncate">
                            <Link href={`/finance/reports?account=${line.account}`} className="tabular-nums hover:text-gold">
                              {line.account}
                            </Link>
                            <span className="ml-2">{nameOf(line.account)}</span>
                          </span>
                          <span className="text-right tabular-nums">{line.debit_cents ? formatMoney(line.debit_cents) : ""}</span>
                          <span className="text-right tabular-nums">{line.credit_cents ? formatMoney(line.credit_cents) : ""}</span>
                          <span className="flex min-w-0 flex-wrap gap-x-2 text-muted">
                            {line.reservation_id && (
                              <Link href={`/reservations/${line.reservation_id}`} className="hover:text-gold">
                                {data.orders.get(line.reservation_id) ?? line.reservation_id.slice(0, 8)}
                              </Link>
                            )}
                            {line.investor_id && <span>{data.investors.get(line.investor_id) ?? line.investor_id.slice(0, 8)}</span>}
                            {line.revenue_class && <span>{line.revenue_class}</span>}
                            {line.stripe_id && <span className="truncate">{line.stripe_id}</span>}
                          </span>
                        </div>
                      ))}
                      <p className="mt-2 text-[11px] text-muted">
                        {t("columns.economic")} {row.economic_date}
                        {row.memo ? ` · ${row.memo}` : ""}
                      </p>
                      <pre className="mt-1 max-h-48 overflow-auto rounded-lg bg-white/70 p-2 text-[11px] text-muted">{JSON.stringify(row.inputs, null, 1)}</pre>
                    </div>
                  </details>
                </li>
              );
            })}
          </ul>
        )}
      </section>
      {pages > 1 && (
        <nav className="mt-4 flex items-center gap-3 text-[13px]">
          {data.page > 0 && (
            <Link href={params(data.page - 1)} className="rounded-pill px-3.5 py-1.5 hairline hover:border-ink/25">
              {t("prev")}
            </Link>
          )}
          <span className="text-muted">{t("page", { page: data.page + 1, pages })}</span>
          {data.page + 1 < pages && (
            <Link href={params(data.page + 1)} className="rounded-pill px-3.5 py-1.5 hairline hover:border-ink/25">
              {t("next")}
            </Link>
          )}
        </nav>
      )}
    </>
  );
}
