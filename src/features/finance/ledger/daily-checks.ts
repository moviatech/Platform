import "server-only";
import { getStripe, stripeConfigured, stripeLive } from "@/lib/stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { readAll } from "../paging";
import type { PostedRow } from "./assemble";
import { chunk } from "./assemble";
import { evaluateChecks, type CheckResult } from "./checks";
import { laDate } from "./dates";
import type { Book } from "./engine";
import { investorIncluded } from "./inclusion";
import { activeMappings, matchLine, type Mapping } from "./mapping";

export type DailyChecks = { ran: boolean; date: string; results: CheckResult[]; issues: number };

type OrderRow = { id: string; number: string; status: string; actual_return_at: string | null; completed_at: string | null; cancelled_at: string | null; updated_at: string };

export async function runDailyChecks(options: { book: Book; liveKey: string | null; now?: number; force?: boolean }): Promise<DailyChecks> {
  const supabase = createAdminClient();
  const now = options.now ?? Date.now();
  const today = laDate(now);
  const cursorKey = `cursor:${options.book}:checks`;
  const { data: cursor, error: cursorError } = await supabase.from("fin_settings").select("value").eq("key", cursorKey).maybeSingle();
  if (cursorError) throw new Error(`fin_settings: ${cursorError.message}`);
  if (!options.force && (cursor?.value as { date?: string } | null)?.date === today) return { ran: false, date: today, results: [], issues: 0 };

  const rpcRows = async <T>(fn: string, args: Record<string, unknown>) => {
    const { data, error } = await supabase.rpc(fn, args);
    if (error) throw new Error(`${fn}: ${error.message}`);
    return (data ?? []) as T[];
  };
  const [trial, orderBalances, ownerBalances, exposed, posted, investorBalances, investors, inclusions, mappings, txns] = await Promise.all([
    rpcRows<{ account: string; debit: number; credit: number }>("fin_trial_balance", { p_book: options.book, p_from: null, p_to: null }),
    rpcRows<{ reservation_id: string; balance: number }>("fin_order_balances", { p_book: options.book, p_as_of: null }),
    rpcRows<{ investor_id: string; account: string; balance: number }>("fin_owner_balances", { p_book: options.book, p_as_of: null }),
    rpcRows<{ object_name: string; grantee: string; privilege: string }>("fin_exposed_grants", {}),
    readAll<PostedRow>((from, to) => supabase.rpc("fin_source_balances", { p_book: options.book, p_source_type: "reservation", p_key_prefix: null }).order("source_key").order("account").order("reservation_id").order("vehicle_id").order("location_id").order("investor_id").order("revenue_class").range(from, to), { maxRows: 200000, strict: true }),
    readAll<{ investor_id: string; available_cents: number; pending_cents: number; invested_cents: number; held_cents: number }>((from, to) => supabase.from("investor_balances").select("investor_id, available_cents, pending_cents, invested_cents, held_cents").order("investor_id").range(from, to), { strict: true }),
    readAll<{ id: string; house: boolean }>((from, to) => supabase.from("investors").select("id, house").order("id").range(from, to), { strict: true }),
    readAll<{ object_id: string; included: boolean }>((from, to) => supabase.from("fin_inclusions").select("object_id, included").eq("object_type", "investor").order("object_id").range(from, to), { strict: true }),
    readAll<Mapping>((from, to) => supabase.from("fin_mappings").select("kind, match, account, mode, version, effective_from").order("id").range(from, to), { strict: true }),
    readAll<{ payment_intent_id: string | null }>((from, to) => supabase.from("stripe_balance_transactions").select("payment_intent_id").eq("livemode", true).not("payment_intent_id", "is", null).order("id").range(from, to), { maxRows: 500000, strict: true }),
  ]);

  const booked = [...new Set([...orderBalances.map((row) => row.reservation_id), ...posted.map((row) => row.reservation_id).filter((id): id is string => Boolean(id))])];
  const orders = (
    await Promise.all(
      chunk(booked, 100).map(async (part) => {
        const { data, error } = await supabase.from("reservations").select("id, number, status, actual_return_at, completed_at, cancelled_at, updated_at").in("id", part);
        if (error) throw new Error(`reservations: ${error.message}`);
        return (data ?? []) as OrderRow[];
      }),
    )
  ).flat();
  const completed = orders.filter((order) => order.status === "COMPLETED");
  const lineMappings = activeMappings(mappings, "LINE", today);
  const spreadByOrder = new Map<string, number>();
  const payments: Array<{ id: string; reservation_id: string; status: string; amount_captured_cents: number; offline_method: string | null; stripe_payment_intent_id: string | null; created_at: string }> = [];
  for (const part of chunk(orders.map((order) => order.id), 100)) {
    const [lines, paid] = await Promise.all([
      readAll<{ reservation_id: string; type: string; code: string; amount_cents: number; created_at: string }>((from, to) => supabase.from("reservation_line_items").select("reservation_id, type, code, amount_cents, created_at").in("reservation_id", part).order("id").range(from, to), { strict: true }),
      readAll<(typeof payments)[number]>((from, to) => supabase.from("payments").select("id, reservation_id, status, amount_captured_cents, offline_method, stripe_payment_intent_id, created_at").in("reservation_id", part).order("id").range(from, to), { strict: true }),
    ]);
    payments.push(...paid);
    for (const line of lines) {
      const order = completed.find((entry) => entry.id === line.reservation_id);
      if (!order) continue;
      const mapping = matchLine(lineMappings, line.type, line.code);
      const late = line.code === "manual.discount" && order.actual_return_at !== null && Date.parse(line.created_at) > Date.parse(order.actual_return_at);
      if (mapping?.mode !== "SPREAD" || late) continue;
      spreadByOrder.set(order.id, (spreadByOrder.get(order.id) ?? 0) + line.amount_cents);
    }
  }
  const intents = new Set(txns.map((row) => row.payment_intent_id as string));
  const unsyncedPayments = payments.filter((payment) => !payment.offline_method && payment.stripe_payment_intent_id && ["SUCCEEDED", "PARTIALLY_REFUNDED"].includes(payment.status) && payment.amount_captured_cents > 0 && now - Date.parse(payment.created_at) > 2 * 3600000 && !intents.has(payment.stripe_payment_intent_id));
  const overrides = new Map(inclusions.map((row) => [row.object_id, row.included]));
  const includedInvestors = new Set(investors.filter((investor) => investorIncluded({ house: investor.house, override: overrides.get(investor.id) ?? null })).map((investor) => investor.id));

  let stripeBalance: number | null = null;
  if (options.book === "live" && stripeConfigured() && stripeLive()) {
    const balance = await getStripe().balance.retrieve();
    stripeBalance = [...balance.available, ...balance.pending].filter((entry) => entry.currency === "usd").reduce((sum, entry) => sum + entry.amount, 0);
  }

  const snapshotCounts = await rpcRows<{ source_table: string; snapshots: number; table_rows: number }>("fin_snapshot_counts", {});

  const checked = evaluateChecks({ today, trial, orderBalances, orders, posted, ownerBalances, investorBalances, includedInvestors, spreadByOrder, unsyncedPayments, exposed, stripeBalance, snapshotCounts });

  for (const part of chunk(checked.issues, 200)) {
    const { error } = await supabase.from("fin_exceptions").upsert(
      part.map((issue) => ({ book: options.book, kind: issue.kind, dedupe_key: issue.dedupeKey, reservation_id: issue.reservationId ?? null, investor_id: issue.investorId ?? null, source_key: issue.sourceKey ?? null, detail: issue.detail ?? {} })),
      { onConflict: "book,dedupe_key", ignoreDuplicates: true },
    );
    if (error) throw new Error(`fin_exceptions: ${error.message}`);
  }
  const { error: saveError } = await supabase.rpc("fin_put_cursor", { p_book: options.book, p_live_key: options.liveKey, p_name: "checks", p_value: { date: today, results: checked.results } });
  if (saveError) throw new Error(`fin_put_cursor: ${saveError.message}`);
  return { ran: true, date: today, results: checked.results, issues: checked.issues.length };
}
