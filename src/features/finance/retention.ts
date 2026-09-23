export const ownerships = ["OWN", "PARTNER"] as const;
export type Ownership = (typeof ownerships)[number];

export type RetentionInput = { closed: boolean; totalCents: number; taxCents: number; paidCents: number; refundedCents: number; ownership: Ownership; payableCents: number };
export type RetentionLine = { count: number; collectedCents: number; taxCents: number; payableCents: number; retainedCents: number };
export type RetentionSummary = Record<Ownership | "TOTAL", RetentionLine>;

export function collectedTax(totalCents: number, taxCents: number, netCents: number) {
  if (totalCents <= 0 || taxCents <= 0 || netCents <= 0) return 0;
  return Math.round(taxCents * Math.min(1, netCents / totalCents));
}

export function rowRetention(row: RetentionInput) {
  const collectedCents = row.paidCents - row.refundedCents;
  const taxCents = row.closed ? 0 : collectedTax(row.totalCents, row.taxCents, collectedCents);
  return { collectedCents, taxCents, payableCents: row.payableCents, retainedCents: collectedCents - taxCents - row.payableCents };
}

const empty = (): RetentionLine => ({ count: 0, collectedCents: 0, taxCents: 0, payableCents: 0, retainedCents: 0 });

export function summarizeRetention(rows: RetentionInput[]): RetentionSummary {
  const summary: RetentionSummary = { OWN: empty(), PARTNER: empty(), TOTAL: empty() };
  for (const row of rows) {
    const line = rowRetention(row);
    for (const key of [row.ownership, "TOTAL"] as const) {
      summary[key].count += 1;
      summary[key].collectedCents += line.collectedCents;
      summary[key].taxCents += line.taxCents;
      summary[key].payableCents += line.payableCents;
      summary[key].retainedCents += line.retainedCents;
    }
  }
  return summary;
}
