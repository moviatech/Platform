import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { readAll } from "../paging";
import { laDate, lastDayOf, monthOf, nextMonth } from "./dates";
import { financeBook, type Book } from "./engine";

export type Account = { code: string; name_zh: string; name_en: string; kind: string };
export type VoucherLine = { line_no: number; account: string; debit_cents: number; credit_cents: number; reservation_id: string | null; vehicle_id: string | null; investor_id: string | null; expense_id: string | null; stripe_id: string | null; revenue_class: string | null };
export type Voucher = { id: number; entry_no: number; economic_date: string; entry_date: string; adjusts_period: string | null; source_type: string; source_key: string; reason: string; inputs: Record<string, unknown>; memo: string | null; posted_at: string; lines: VoucherLine[] };

export const VOUCHER_PAGE = 100;
const isMonth = (value: unknown): value is string => typeof value === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
const isDate = (value: unknown): value is string => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);

export const currentMonth = () => monthOf(laDate(Date.now()));
export const pickMonth = (value: unknown) => (isMonth(value) ? value : currentMonth());
export const pickDate = (value: unknown) => (isDate(value) ? value : null);

export async function loadAccounts() {
  const rows = await readAll<Account>((from, to) => createAdminClient().from("fin_accounts").select("code, name_zh, name_en, kind").order("sort").range(from, to));
  return new Map(rows.map((row) => [row.code, row]));
}

export async function loadFreshness(): Promise<{ book: Book; lastRun: string | null }> {
  const book = financeBook();
  const { data } = await createAdminClient().from("fin_job_runs").select("finished_at").eq("job", "tick").eq("ok", true).order("id", { ascending: false }).limit(1).maybeSingle();
  return { book, lastRun: (data?.finished_at as string | undefined) ?? null };
}

async function orderNumbers(ids: string[]) {
  const unique = [...new Set(ids.filter(Boolean))];
  if (unique.length === 0) return new Map<string, string>();
  const { data } = await createAdminClient().from("reservations").select("id, number").in("id", unique.slice(0, 500));
  return new Map(((data ?? []) as Array<{ id: string; number: string }>).map((row) => [row.id, row.number]));
}

async function investorNumbers(ids: string[]) {
  const unique = [...new Set(ids.filter(Boolean))];
  if (unique.length === 0) return new Map<string, string>();
  const { data } = await createAdminClient().from("investors").select("id, investor_number").in("id", unique.slice(0, 500));
  return new Map(((data ?? []) as Array<{ id: string; investor_number: string }>).map((row) => [row.id, row.investor_number]));
}

export async function findOrder(number: string) {
  const value = number.trim().toUpperCase();
  if (!/^MV-[A-Z0-9]{4,10}$/.test(value)) return null;
  const { data } = await createAdminClient().from("reservations").select("id, number").eq("number", value).maybeSingle();
  return (data as { id: string; number: string } | null) ?? null;
}

export type VoucherFilter = { from: string | null; to: string | null; source: string | null; order: string | null; account: string | null; vehicle: string | null; economic: boolean; page: number };

export async function loadVouchers(filter: VoucherFilter) {
  const supabase = createAdminClient();
  const book = financeBook();
  const order = filter.order ? await findOrder(filter.order) : null;
  if (filter.order && !order) return { book, page: 0, rows: [] as Voucher[], total: 0, orders: new Map<string, string>(), investors: new Map<string, string>() };
  const lineFilter = Boolean(filter.account || order || filter.vehicle);
  const dateColumn = filter.economic ? "economic_date" : "entry_date";
  const matching = (head: boolean) => {
    let query = supabase
      .from("fin_journal_entries")
      .select(lineFilter ? "id, fin_journal_lines!inner(account, reservation_id, vehicle_id)" : "id", { count: "exact", head })
      .eq("book", book);
    if (filter.from) query = query.gte(dateColumn, filter.from);
    if (filter.to) query = query.lte(dateColumn, filter.to);
    if (filter.source) query = query.eq("source_type", filter.source);
    if (filter.account) query = query.eq("fin_journal_lines.account", filter.account);
    if (order) query = query.eq("fin_journal_lines.reservation_id", order.id);
    if (filter.vehicle) query = query.eq("fin_journal_lines.vehicle_id", filter.vehicle);
    return query;
  };
  const { count, error: countError } = await matching(true);
  if (countError) throw new Error(`fin_journal_entries: ${countError.message}`);
  const total = count ?? 0;
  const page = Math.min(filter.page, Math.max(0, Math.ceil(total / VOUCHER_PAGE) - 1));
  if (total === 0) return { book, page, rows: [] as Voucher[], total, orders: new Map<string, string>(), investors: new Map<string, string>() };
  const start = page * VOUCHER_PAGE;
  const { data: matched, error } = await matching(false).order("entry_no", { ascending: false }).range(start, start + VOUCHER_PAGE - 1);
  if (error) throw new Error(`fin_journal_entries: ${error.message}`);
  const ids = [...new Set(((matched ?? []) as unknown as Array<{ id: number }>).map((row) => row.id))];
  if (ids.length === 0) return { book, page, rows: [] as Voucher[], total, orders: new Map<string, string>(), investors: new Map<string, string>() };
  const { data: full, error: fullError } = await supabase
    .from("fin_journal_entries")
    .select("id, entry_no, economic_date, entry_date, adjusts_period, source_type, source_key, reason, inputs, memo, posted_at, lines:fin_journal_lines(line_no, account, debit_cents, credit_cents, reservation_id, vehicle_id, investor_id, expense_id, stripe_id, revenue_class)")
    .in("id", ids)
    .order("entry_no", { ascending: false });
  if (fullError) throw new Error(`fin_journal_entries: ${fullError.message}`);
  const rows = ((full ?? []) as unknown as Voucher[]).map((row) => ({ ...row, lines: [...row.lines].sort((a, b) => a.line_no - b.line_no) }));
  const lines = rows.flatMap((row) => row.lines);
  const [orders, investors] = await Promise.all([orderNumbers(lines.map((line) => line.reservation_id ?? "")), investorNumbers(lines.map((line) => line.investor_id ?? ""))]);
  return { book, page, rows, total, orders, investors };
}

export async function loadTrial(month: string | null) {
  const book = financeBook();
  const from = month ? `${month}-01` : null;
  const to = month ? lastDayOf(month) : null;
  const { data, error } = await createAdminClient().rpc("fin_trial_balance", { p_book: book, p_from: from, p_to: to });
  if (error) throw new Error(`fin_trial_balance: ${error.message}`);
  return { book, from, to, rows: ((data ?? []) as Array<{ account: string; debit: number; credit: number }>).map((row) => ({ account: row.account, debit: Number(row.debit), credit: Number(row.credit) })) };
}

export type CheckSummary = { date: string | null; results: Array<{ name: string; ok: boolean; count: number }> };
export type RunRow = { id: number; started_at: string; finished_at: string | null; ok: boolean | null; error: string | null; counts: { ms?: number; host?: string; steps?: Array<{ name: string; ok: boolean; error?: string; result?: Record<string, unknown> }> } };

export async function loadChecks() {
  const book = financeBook();
  const supabase = createAdminClient();
  const [{ data: cursor }, { data: runs }] = await Promise.all([
    supabase.from("fin_settings").select("value").eq("key", `cursor:${book}:checks`).maybeSingle(),
    supabase.from("fin_job_runs").select("id, started_at, finished_at, ok, error, counts").eq("job", "tick").order("id", { ascending: false }).limit(12),
  ]);
  const value = (cursor?.value ?? null) as { date?: string; results?: CheckSummary["results"] } | null;
  return { book, checks: { date: value?.date ?? null, results: value?.results ?? [] } as CheckSummary, runs: (runs ?? []) as RunRow[] };
}

export type ExceptionRow = { id: number; kind: string; dedupe_key: string; reservation_id: string | null; investor_id: string | null; source_key: string | null; detail: Record<string, unknown>; status: string; note: string | null; opened_at: string; resolved_at: string | null };
export type ResolutionRow = { id: string; reservation_id: string; category: string; amount_cents: number; reason: string; evidence_path: string | null; created_by: string; approved_by: string | null; created_at: string; voided_at: string | null; void_reason: string | null };

export async function loadPending() {
  const book = financeBook();
  const supabase = createAdminClient();
  const [open, resolved, resolutions] = await Promise.all([
    readAll<ExceptionRow>((from, to) => supabase.from("fin_exceptions").select("id, kind, dedupe_key, reservation_id, investor_id, source_key, detail, status, note, opened_at, resolved_at").eq("book", book).eq("status", "OPEN").order("opened_at", { ascending: false }).range(from, to), { maxRows: 2000 }),
    supabase.from("fin_exceptions").select("id, kind, dedupe_key, reservation_id, investor_id, source_key, detail, status, note, opened_at, resolved_at").eq("book", book).eq("status", "RESOLVED").order("resolved_at", { ascending: false }).limit(20),
    supabase.from("fin_order_resolutions").select("id, reservation_id, category, amount_cents, reason, evidence_path, created_by, approved_by, created_at, voided_at, void_reason").eq("book", book).order("created_at", { ascending: false }).limit(200),
  ]);
  const done = (resolved.data ?? []) as ExceptionRow[];
  const decisions = (resolutions.data ?? []) as ResolutionRow[];
  const people = [...new Set(decisions.flatMap((row) => [row.created_by, row.approved_by ?? ""]).filter(Boolean))];
  const [orders, investors, staff] = await Promise.all([
    orderNumbers([...open, ...done].map((row) => row.reservation_id ?? "").concat(decisions.map((row) => row.reservation_id))),
    investorNumbers([...open, ...done].map((row) => row.investor_id ?? "")),
    people.length ? supabase.from("staff_members").select("user_id, display_name").in("user_id", people) : Promise.resolve({ data: [] }),
  ]);
  const names = new Map(((staff.data ?? []) as Array<{ user_id: string; display_name: string }>).map((row) => [row.user_id, row.display_name]));
  return { book, open, resolved: done, resolutions: decisions, orders, investors, names };
}

export type PeriodRow = { period: string; locked_at: string | null; locked_by: string | null; reopened_at: string | null; reopen_reason: string | null; digest: string | null };

export async function loadMonths() {
  const book = financeBook();
  const { data } = await createAdminClient().from("fin_periods").select("period, locked_at, locked_by, reopened_at, reopen_reason, digest").eq("book", book).order("period", { ascending: false });
  const periods = new Map(((data ?? []) as PeriodRow[]).map((row) => [row.period, row]));
  const now = currentMonth();
  const months: string[] = [];
  for (let month = "2026-11"; month <= now; month = nextMonth(month)) months.push(month);
  for (const period of periods.keys()) if (!months.includes(period)) months.push(period);
  return { book, current: now, months: months.sort().reverse(), periods };
}
