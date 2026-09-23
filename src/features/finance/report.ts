export const revenueGroups = ["RENTAL", "PROTECTION", "ADD_ONS", "FEES", "POST_RENTAL", "DISCOUNT", "CANCELLATION"] as const;
export type RevenueGroup = (typeof revenueGroups)[number];

export const expenseCategories = ["CHARGING", "CLEANING", "INSURANCE", "REGISTRATION", "MAINTENANCE", "TOLLS_TICKETS", "PARKING", "VEHICLE_FINANCE", "PAYMENT_FEES", "MARKETING", "SOFTWARE", "PAYROLL", "RENT", "OTHER"] as const;
export type ExpenseCategory = (typeof expenseCategories)[number];

export const costCategories = [...expenseCategories, "SERVICE", "STRIPE"] as const;
export type CostCategory = (typeof costCategories)[number];

export const expenseMethods = ["CARD", "ACH", "ZELLE", "CASH", "CHECK", "OTHER"] as const;
export type ExpenseMethod = (typeof expenseMethods)[number];

export const receiptTypes = /^(application\/pdf|image\/(jpeg|png|webp|heic))$/;
export const maxReceiptBytes = 10 * 1024 * 1024;

export type ReportLine = { type: string; code: string; amount_cents: number };
export type CostItem = { category: CostCategory; amountCents: number };

export type Statement = {
  revenue: Record<RevenueGroup, number>;
  revenueCents: number;
  taxCents: number;
  payableCents: number;
  grossCents: number;
  costs: Record<CostCategory, number>;
  costCents: number;
  profitCents: number;
};

const monthPattern = /^\d{4}-(0[1-9]|1[0-2])$/;

export const isMonth = (value: unknown): value is string => typeof value === "string" && monthPattern.test(value);

export function shiftMonth(month: string, delta: number) {
  const [y, m] = month.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function monthRange(month: string) {
  const [y, m] = month.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, "0")}`, days: last };
}

export function lineGroup(line: Pick<ReportLine, "type" | "code">): RevenueGroup | "TAX" {
  if (line.type === "TAX" || line.code === "fee.tax") return "TAX";
  if (line.type === "RENTAL") return "RENTAL";
  if (line.type === "PROTECTION") return "PROTECTION";
  if (line.type === "ADD_ON" || line.type === "YOUNG_DRIVER") return "ADD_ONS";
  if (line.type === "ADDITIONAL") return "POST_RENTAL";
  if (line.type === "DISCOUNT") return "DISCOUNT";
  return "FEES";
}

export function netOfTax(lines: ReportLine[]) {
  return lines.reduce((sum, line) => (lineGroup(line) === "TAX" ? sum : sum + line.amount_cents), 0);
}

export function buildStatement(input: { lines: ReportLine[]; cancellationCents: number; payableCents: number; costs: CostItem[] }): Statement {
  const revenue = Object.fromEntries(revenueGroups.map((group) => [group, 0])) as Record<RevenueGroup, number>;
  let taxCents = 0;
  for (const line of input.lines) {
    const group = lineGroup(line);
    if (group === "TAX") taxCents += line.amount_cents;
    else revenue[group] += line.amount_cents;
  }
  revenue.CANCELLATION = input.cancellationCents;
  const revenueCents = revenueGroups.reduce((sum, group) => sum + revenue[group], 0);
  const costs = Object.fromEntries(costCategories.map((category) => [category, 0])) as Record<CostCategory, number>;
  for (const item of input.costs) costs[item.category] += item.amountCents;
  const costCents = costCategories.reduce((sum, category) => sum + costs[category], 0);
  const grossCents = revenueCents - input.payableCents;
  return { revenue, revenueCents, taxCents, payableCents: input.payableCents, grossCents, costs, costCents, profitCents: grossCents - costCents };
}
