import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { readAll } from "./paging";
import { linkableExpenses, matchVendor, nonCardTotals, unlinkedPayees, type VendorTaxClass } from "./vendors";

export type VendorRow = { id: string; name: string; tax_class: VendorTaxClass; needs_1099: boolean; w9_received_on: string | null; note: string | null; active: boolean };

const columns = "id, name, tax_class, needs_1099, w9_received_on, note, active";

export async function loadVendors(year: string) {
  const supabase = createAdminClient();
  const [vendors, spent, linked, loose] = await Promise.all([
    readAll<VendorRow>((from, to) => supabase.from("fin_vendors").select(columns).order("active", { ascending: false }).order("name").order("id").range(from, to), { strict: true }),
    readAll<{ vendor_id: string | null; method: string; amount_cents: number; voided_at: string | null }>((from, to) => supabase.from("expenses").select("vendor_id, method, amount_cents, voided_at").not("vendor_id", "is", null).gte("spent_on", `${year}-01-01`).lte("spent_on", `${year}-12-31`).order("id").range(from, to), { strict: true }),
    readAll<{ vendor_id: string }>((from, to) => supabase.from("expenses").select("vendor_id").not("vendor_id", "is", null).order("id").range(from, to), { maxRows: 100000, strict: true }),
    readAll<{ vendor: string | null; vendor_id: string | null; method: string; amount_cents: number; voided_at: string | null }>((from, to) => supabase.from("expenses").select("vendor, vendor_id, method, amount_cents, voided_at").is("vendor_id", null).not("vendor", "is", null).gte("spent_on", `${year}-01-01`).lte("spent_on", `${year}-12-31`).order("id").range(from, to), { strict: true }),
  ]);
  return { vendors, totals: nonCardTotals(spent), used: new Set(linked.map((row) => row.vendor_id)), unlinked: unlinkedPayees(loose) };
}

export async function listVendorNames(): Promise<string[]> {
  const { data } = await createAdminClient().from("fin_vendors").select("name").eq("active", true).order("name");
  return ((data ?? []) as Array<{ name: string }>).map((row) => row.name);
}

export async function vendorIdFor(name: string | null | undefined): Promise<string | null> {
  if (!name || !name.trim()) return null;
  const { data } = await createAdminClient().from("fin_vendors").select("id, name, active").eq("active", true);
  return matchVendor(name, (data ?? []) as Array<{ id: string; name: string; active: boolean }>)?.id ?? null;
}

export async function linkEarlierExpenses(vendorId: string, name: string) {
  const supabase = createAdminClient();
  const rows = await readAll<{ id: string; vendor: string | null; vendor_id: string | null }>((from, to) => supabase.from("expenses").select("id, vendor, vendor_id").is("vendor_id", null).not("vendor", "is", null).order("id").range(from, to), { maxRows: 100000, strict: true });
  const ids = linkableExpenses(name, rows);
  let linked = 0;
  for (let start = 0; start < ids.length; start += 200) {
    const { data, error } = await supabase.from("expenses").update({ vendor_id: vendorId }).in("id", ids.slice(start, start + 200)).is("vendor_id", null).select("id");
    if (error) break;
    linked += data?.length ?? 0;
  }
  return linked;
}
