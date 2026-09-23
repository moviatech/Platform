export const vendorTaxClasses = ["INDIVIDUAL", "PARTNERSHIP", "LLC", "C_CORP", "S_CORP", "OTHER", "UNKNOWN"] as const;
export type VendorTaxClass = (typeof vendorTaxClasses)[number];

export const NEC_THRESHOLD_CENTS = 200000;

export const vendorKey = (name: string) => name.trim().replace(/\s+/g, " ").toLowerCase();

export function matchVendor<T extends { name: string; active: boolean }>(name: string | null | undefined, vendors: T[]): T | null {
  if (!name || !name.trim()) return null;
  const wanted = vendorKey(name);
  return vendors.find((vendor) => vendor.active && vendorKey(vendor.name) === wanted) ?? null;
}

export function nonCardTotals(rows: Array<{ vendor_id: string | null; method: string; amount_cents: number; voided_at: string | null }>) {
  const totals = new Map<string, number>();
  for (const row of rows) {
    if (!row.vendor_id || row.voided_at || row.method === "CARD") continue;
    totals.set(row.vendor_id, (totals.get(row.vendor_id) ?? 0) + row.amount_cents);
  }
  return totals;
}

export function unlinkedPayees(rows: Array<{ vendor: string | null; vendor_id: string | null; method: string; amount_cents: number; voided_at: string | null }>) {
  const groups = new Map<string, { name: string; cents: number }>();
  for (const row of rows) {
    if (row.vendor_id || !row.vendor || !row.vendor.trim() || row.voided_at || row.method === "CARD") continue;
    const key = vendorKey(row.vendor);
    const group = groups.get(key) ?? { name: row.vendor.trim().replace(/\s+/g, " "), cents: 0 };
    group.cents += row.amount_cents;
    groups.set(key, group);
  }
  return [...groups.values()].sort((a, b) => b.cents - a.cents || a.name.localeCompare(b.name));
}

export const linkableExpenses = (name: string, rows: Array<{ id: string; vendor: string | null; vendor_id: string | null }>) => {
  const wanted = vendorKey(name);
  return rows.filter((row) => !row.vendor_id && row.vendor && vendorKey(row.vendor) === wanted).map((row) => row.id);
};

export const missingW9 = (vendor: { needs_1099: boolean; w9_received_on: string | null }, totalCents: number) => vendor.needs_1099 && !vendor.w9_received_on && totalCents >= NEC_THRESHOLD_CENTS;
