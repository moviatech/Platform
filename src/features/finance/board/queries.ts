import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { zonedParts } from "@/features/booking/time";
import { financeBook } from "../ledger/engine";
import { readAll } from "../paging";
import type { CashReport, Fleet, PnlRow } from "./metrics";
import type { BoardRange } from "./range";

type Client = ReturnType<typeof createAdminClient>;

const pnl = (supabase: Client, book: string, from: string, to: string, group: "vehicle" | "channel" | "location") =>
  readAll<PnlRow>((start, stop) => supabase.rpc("fin_report_pnl", { p_book: book, p_from: from, p_to: to, p_group: group }).range(start, stop), { pageSize: 1000, maxRows: 50000, strict: true });

async function single<T>(name: string, run: PromiseLike<{ data: unknown; error: { message: string } | null }>) {
  const { data, error } = await run;
  if (error) throw new Error(`${name}: ${error.message}`);
  return data as T;
}

export async function loadFleet(from: string, to: string, now: Date) {
  return single<Fleet>("fin_report_fleet", createAdminClient().rpc("fin_report_fleet", { p_from: from, p_to: to, p_now: now.toISOString() }));
}

export async function loadBoard(range: BoardRange, now: Date) {
  const supabase = createAdminClient();
  const book = financeBook();
  const [current, previous, channels, stores, cash, currentFleet, previousFleet, locations, due] = await Promise.all([
    pnl(supabase, book, range.from, range.end, "vehicle"),
    pnl(supabase, book, range.prevFrom, range.prevTo, "vehicle"),
    pnl(supabase, book, range.from, range.end, "channel"),
    pnl(supabase, book, range.from, range.end, "location"),
    single<CashReport>("fin_report_cash", supabase.rpc("fin_report_cash", { p_book: book, p_as_of: range.end })),
    loadFleet(range.from, range.daysEnd ?? range.from, now),
    loadFleet(range.prevFrom, range.prevTo, now),
    storeNames(supabase),
    loadDue(zonedParts(now, "America/Los_Angeles").date),
  ]);
  const fleet = range.daysEnd ? currentFleet : { ...currentFleet, channels: [], vehicles: currentFleet.vehicles.map((vehicle) => ({ ...vehicle, serviceDays: 0, rentedDays: 0, revenueDays: 0, downDays: 0, depreciationDays: 0 })) };
  return { book, current, previous, channels, stores, cash: { ...cash, pending: { ...cash.pending, due: due.service + due.recurring } }, fleet, previousFleet, locations };
}

export type Due = { service: number; recurring: number };

export async function loadDue(today: string): Promise<Due> {
  const due = await single<Due>("fin_report_due", createAdminClient().rpc("fin_report_due", { p_today: today }));
  return { service: Number(due.service), recurring: Number(due.recurring) };
}

export type StoreName = { id: string; name: string; name_zh: string | null };

const STORE_NAMES_MS = 5 * 60000;
let storeCache: { at: number; rows: StoreName[] } | null = null;

async function storeNames(supabase: Client) {
  if (storeCache && Date.now() - storeCache.at < STORE_NAMES_MS) return storeCache.rows;
  const rows = (await single<StoreName[] | null>("locations", supabase.from("locations").select("id, name, name_zh").order("name"))) ?? [];
  storeCache = { at: Date.now(), rows };
  return rows;
}

export type BankBalance = { id: number; account_name: string; as_of: string; balance_cents: number; entered_at: string };

export async function loadBankBalances() {
  const { data, error } = await createAdminClient().from("fin_bank_balances").select("id, account_name, as_of, balance_cents, entered_at").order("as_of", { ascending: false }).order("id", { ascending: false }).limit(100);
  if (error) throw new Error(`fin_bank_balances: ${error.message}`);
  return (data ?? []) as BankBalance[];
}
