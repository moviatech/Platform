import "server-only";
import { zonedParts } from "@/features/booking/time";
import { createAdminClient } from "@/lib/supabase/admin";
import { ownerYearTotals, yearBounds, type OwnerEntry } from "./owners";
import { rangeBounds } from "./queries";

export type OwnerRow = { id: string; investor_number: string; legal_name: string; email: string; compensation: string; earningsCents: number; capitalReturnedCents: number; paidCents: number; owedCents: number };

export async function loadOwnerYear(year: number): Promise<OwnerRow[]> {
  const supabase = createAdminClient();
  const { start, end } = rangeBounds(yearBounds(year));
  const entries: Array<OwnerEntry & { id: string }> = [];
  for (let offset = 0; offset < 50000; offset += 1000) {
    const { data } = await supabase.from("investor_ledger_entries").select("id, investor_id, type, bucket, amount_cents, reversal_of").gte("created_at", start).lt("created_at", end).order("created_at").order("id").range(offset, offset + 999);
    entries.push(...((data ?? []) as Array<OwnerEntry & { id: string }>));
    if ((data ?? []).length < 1000) break;
  }
  const reversed = [...new Set(entries.filter((entry) => entry.type === "REVERSAL" && entry.reversal_of).map((entry) => entry.reversal_of as string))];
  const originals = new Map<string, string>();
  for (let index = 0; index < reversed.length; index += 100) {
    const { data } = await supabase.from("investor_ledger_entries").select("id, type").in("id", reversed.slice(index, index + 100));
    for (const row of data ?? []) originals.set(row.id as string, row.type as string);
  }
  const [{ data: paid }, { data: investors }, { data: balances }] = await Promise.all([
    supabase.from("investor_withdrawals").select("investor_id, amount_cents").eq("status", "PAID").gte("paid_at", start).lt("paid_at", end).limit(5000),
    supabase.from("investors").select("id, investor_number, legal_name, email, compensation").eq("house", false).order("legal_name").limit(2000),
    supabase.from("investor_balances").select("investor_id, available_cents, pending_cents"),
  ]);
  const totals = ownerYearTotals(entries, originals, (paid ?? []) as Array<{ investor_id: string; amount_cents: number }>);
  const current = year === Number(zonedParts(new Date(), "America/Los_Angeles").date.slice(0, 4));
  const owed = new Map((balances ?? []).map((row) => [row.investor_id as string, (row.available_cents ?? 0) + (row.pending_cents ?? 0)]));
  return ((investors ?? []) as Array<{ id: string; investor_number: string; legal_name: string; email: string; compensation: string }>)
    .map((investor) => ({ ...investor, ...(totals.get(investor.id) ?? { earningsCents: 0, capitalReturnedCents: 0, paidCents: 0 }), owedCents: owed.get(investor.id) ?? 0 }))
    .filter((row) => row.earningsCents !== 0 || row.capitalReturnedCents !== 0 || row.paidCents !== 0 || (current && row.owedCents !== 0))
    .sort((a, b) => b.earningsCents - a.earningsCents);
}
