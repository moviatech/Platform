export type ShareBase = { rentalCents: number; discountCents: number; baseCents: number };
export type ShareLine = { type: string; code: string; amount_cents: number };
export type DatedLine = ShareLine & { created_at: string };
export type AllocationSpan = { id: string; effective_from: string; effective_to: string | null };

const excluded = new Set(["TAX", "ADDITIONAL"]);

export function computeShareBase(lines: ShareLine[]): ShareBase {
  const rentalCents = lines.filter((line) => line.type === "RENTAL").reduce((sum, line) => sum + line.amount_cents, 0);
  const positive = lines.filter((line) => line.amount_cents > 0 && !excluded.has(line.type)).reduce((sum, line) => sum + line.amount_cents, 0);
  const discounts = -lines.filter((line) => line.amount_cents < 0 && !excluded.has(line.type)).reduce((sum, line) => sum + line.amount_cents, 0);
  const discountCents = positive > 0 ? Math.min(rentalCents, Math.round((discounts * rentalCents) / positive)) : 0;
  return { rentalCents, discountCents, baseCents: Math.max(0, rentalCents - discountCents) };
}

export const shareOf = (baseCents: number, revenueShareBps: number, shareBps: number) => Math.round((((baseCents * revenueShareBps) / 10000) * shareBps) / 10000);

export function refundCut(shareCents: number, refundCents: number, totalCents: number) {
  if (shareCents <= 0 || refundCents <= 0 || totalCents <= 0) return 0;
  return Math.round(shareCents * Math.min(1, refundCents / totalCents));
}

export function lateDiscountCents(lines: DatedLine[], completedAt: string) {
  const completed = Date.parse(completedAt);
  return lines.filter((line) => line.amount_cents < 0 && !excluded.has(line.type) && Date.parse(line.created_at) > completed).reduce((sum, line) => sum - line.amount_cents, 0);
}

export function backfillQuote(input: { lines: DatedLine[]; completedAt: string; refundedCents: number; totalCents: number; revenueShareBps: number; shareBps: number }) {
  const base = computeShareBase(input.lines);
  const shareCents = shareOf(base.baseCents, input.revenueShareBps, input.shareBps);
  const refundCents = Math.max(0, input.refundedCents - lateDiscountCents(input.lines, input.completedAt));
  const cutCents = refundCut(shareCents, refundCents, input.totalCents);
  return { base, shareCents, refundCents, cutCents, netCents: shareCents - cutCents };
}

export function coveringAllocation<T extends AllocationSpan>(spans: T[], onDate: string): T | null {
  const covering = spans.filter((span) => span.effective_from <= onDate && (span.effective_to === null || span.effective_to >= onDate));
  return covering.sort((a, b) => b.effective_from.localeCompare(a.effective_from))[0] ?? null;
}
