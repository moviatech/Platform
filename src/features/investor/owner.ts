import "server-only";
import { latestStatements, listStatements, previousMonth, type MileageStatement } from "./mileage";

export type OwnerOverview = { lastMonth: string; last: MileageStatement[]; lastMiles: number; lastCents: number; totalMiles: number; totalCents: number; latest: Record<string, MileageStatement> };

const sum = (rows: MileageStatement[], pick: (row: MileageStatement) => number) => rows.reduce((total, row) => total + pick(row), 0);

export async function ownerOverview(investorId: string, month: string): Promise<OwnerOverview> {
  const [issued, latest] = await Promise.all([listStatements({ investorId, statuses: ["ISSUED", "DISPUTED", "SETTLED"], limit: 1000 }), latestStatements(investorId)]);
  const lastMonth = previousMonth(month);
  const last = issued.filter((row) => row.month.startsWith(lastMonth));
  return {
    lastMonth,
    last,
    lastMiles: sum(last, (row) => row.qualifying_miles),
    lastCents: sum(last, (row) => row.amount_cents),
    totalMiles: sum(issued, (row) => row.qualifying_miles),
    totalCents: sum(issued, (row) => row.amount_cents),
    latest,
  };
}

export type OwnerMonth = { statements: MileageStatement[]; totals: { gross: number; adjustments: number; miles: number; amountCents: number }; rates: number[] };

export async function ownerMonth(investorId: string, month: string): Promise<OwnerMonth> {
  const statements = await listStatements({ investorId, month });
  const totals = statements.reduce(
    (acc, row) => ({
      gross: acc.gross + (row.start_reading !== null && row.end_reading !== null ? Math.max(0, row.end_reading - row.start_reading) : 0),
      adjustments: acc.adjustments + row.adjustment_miles,
      miles: acc.miles + row.qualifying_miles,
      amountCents: acc.amountCents + row.amount_cents,
    }),
    { gross: 0, adjustments: 0, miles: 0, amountCents: 0 },
  );
  return { statements, totals, rates: [...new Set(statements.map((row) => row.rate_cents))] };
}

export const rateLabel = (rates: number[], format: (cents: number) => string) => (rates.length === 0 ? "—" : rates.length === 1 ? format(rates[0]) : `${format(Math.min(...rates))}–${format(Math.max(...rates))}`);

export const canDispute = (statement: MileageStatement, now: number) => statement.status === "ISSUED" && statement.dispute_until !== null && Date.parse(statement.dispute_until) > now && statement.qualifying_miles > 0;
