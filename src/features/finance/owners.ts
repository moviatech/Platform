export type OwnerEntry = { investor_id: string; type: string; bucket: string; amount_cents: number; reversal_of: string | null };
export type OwnerYear = { earningsCents: number; capitalReturnedCents: number; paidCents: number };

const earningTypes = new Set(["RENTAL_SHARE", "MILEAGE_FEE", "ADJUSTMENT"]);

export function ownerYearTotals(entries: OwnerEntry[], originals: Map<string, string>, paid: Array<{ investor_id: string; amount_cents: number }>): Map<string, OwnerYear> {
  const result = new Map<string, OwnerYear>();
  const line = (investorId: string) => {
    if (!result.has(investorId)) result.set(investorId, { earningsCents: 0, capitalReturnedCents: 0, paidCents: 0 });
    return result.get(investorId)!;
  };
  for (const entry of entries) {
    if (earningTypes.has(entry.type)) line(entry.investor_id).earningsCents += entry.amount_cents;
    else if (entry.type === "REVERSAL" && entry.reversal_of && earningTypes.has(originals.get(entry.reversal_of) ?? "")) line(entry.investor_id).earningsCents += entry.amount_cents;
    else if (entry.type === "CAPITAL_RETURN" && entry.bucket === "AVAILABLE") line(entry.investor_id).capitalReturnedCents += entry.amount_cents;
  }
  for (const payment of paid) line(payment.investor_id).paidCents += payment.amount_cents;
  return result;
}

export function yearBounds(year: number) {
  return { from: `${year}-01-01`, to: `${year}-12-31` };
}

export const isYear = (value: unknown): value is string => typeof value === "string" && /^20\d{2}$/.test(value);
