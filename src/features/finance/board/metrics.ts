import { laDate, monthOf } from "../ledger/dates";
import { shiftMonths } from "./range";

export type PnlRow = { group_key: string | null; account: string; kind: string; name_zh: string; name_en: string; debit_cents: number; credit_cents: number };

export type FleetVehicle = {
  id: string;
  fleetNumber: string | null;
  plate: string | null;
  classId: string | null;
  classSlug: string | null;
  className: string | null;
  classNameZh: string | null;
  condition: string | null;
  createdOn: string;
  inServiceOn: string | null;
  serviceFrom: string;
  retiredOn: string | null;
  ownerExitOn: string | null;
  purchasePriceCents: number | null;
  depreciationMonths: number | null;
  residualCents: number | null;
  monthlyPaymentCents: number | null;
  purchaseTax: string | null;
  taxEvidencePath: string | null;
  insuranceMonthlyCents: number | null;
  registrationYearlyCents: number | null;
  costsUpdatedAt: string | null;
  ownerCar: boolean;
  serviceDays: number;
  rentedDays: number;
  revenueDays: number;
  downDays: number;
  depreciationDays: number;
};

export type Fleet = {
  vehicles: FleetVehicle[];
  channels: Array<{ source: string | null; orders: number; days: number }>;
  forward: Array<{ days: number; bookedDays: number; revenueCents: number }>;
};

export type CashReport = {
  accounts: Record<string, number>;
  orders: { receivable: number; receivableOrders: number; overdueDays: number; prepaid: number; credits: number };
  bank: { total: number; latest: string | null; oldest: string | null; accounts: number };
  flows: Array<{ month: string; net: number }>;
  firstDate: string | null;
  owners: { count: number; cents: number; oldest: string | null; nextSettle: string | null };
  holds: { count: number; cents: number };
  pending: { exceptions: number; approvals: number; due?: number };
};

export type Totals = { gross: number; discounts: number; revenue: number; rent: number; recoveries: number; owner: number; orderCosts: number; expenses: number; fixedExpenses: number; net: number };

export const RENT_ACCOUNT = "4010";
export const RECOVERY_ACCOUNT = "4080";
export const OWNER_ACCOUNTS = new Set(["5010", "5015", "5020"]);
export const FIXED_EXPENSE_ACCOUNTS = new Set(["6030", "6040", "6080"]);
export const MONTH_DAYS = 365.25 / 12;

export function totals(rows: PnlRow[]): Totals {
  const sum: Totals = { gross: 0, discounts: 0, revenue: 0, rent: 0, recoveries: 0, owner: 0, orderCosts: 0, expenses: 0, fixedExpenses: 0, net: 0 };
  for (const row of rows) {
    const value = Number(row.credit_cents) - Number(row.debit_cents);
    sum.net += value;
    if (row.kind === "REVENUE") {
      if (row.account === RECOVERY_ACCOUNT) sum.recoveries += value;
      else sum.gross += value;
      if (row.account === RENT_ACCOUNT) sum.rent += value;
    } else if (row.kind === "CONTRA_REVENUE") sum.discounts -= value;
    else if (row.kind === "COST") {
      if (OWNER_ACCOUNTS.has(row.account)) sum.owner -= value;
      else sum.orderCosts -= value;
    } else if (row.kind === "EXPENSE") {
      sum.expenses -= value;
      if (FIXED_EXPENSE_ACCOUNTS.has(row.account)) sum.fixedExpenses -= value;
    }
  }
  sum.revenue = sum.gross - sum.discounts;
  return sum;
}

type Depreciable = Pick<FleetVehicle, "purchasePriceCents" | "depreciationMonths" | "residualCents">;

export const depreciableCents = (vehicle: Depreciable) =>
  vehicle.purchasePriceCents && vehicle.depreciationMonths ? Math.max(0, vehicle.purchasePriceCents - (vehicle.residualCents ?? 0)) : 0;

export function depreciationCents(vehicle: Depreciable & Pick<FleetVehicle, "depreciationDays">) {
  if (!vehicle.depreciationMonths) return 0;
  return Math.round((depreciableCents(vehicle) / vehicle.depreciationMonths / MONTH_DAYS) * vehicle.depreciationDays);
}

export const fixedMonthlyCents = (vehicle: Depreciable & Pick<FleetVehicle, "monthlyPaymentCents" | "insuranceMonthlyCents" | "registrationYearlyCents">) =>
  (vehicle.depreciationMonths ? depreciableCents(vehicle) / vehicle.depreciationMonths : 0) +
  (vehicle.monthlyPaymentCents ?? 0) +
  (vehicle.insuranceMonthlyCents ?? 0) +
  (vehicle.registrationYearlyCents ?? 0) / 12;

export const hasFixedCosts = (vehicle: Pick<FleetVehicle, "purchasePriceCents" | "monthlyPaymentCents" | "insuranceMonthlyCents" | "registrationYearlyCents">) =>
  [vehicle.purchasePriceCents, vehicle.monthlyPaymentCents, vehicle.insuranceMonthlyCents, vehicle.registrationYearlyCents].some((value) => value !== null && value !== undefined);

export type VehicleRow = {
  vehicle: FleetVehicle;
  totals: Totals;
  revenue: number;
  ownerShare: number;
  costs: number;
  depreciation: number;
  contribution: number;
  availableDays: number;
  occupancy: number | null;
};

export type Period = {
  all: Totals;
  rows: VehicleRow[];
  fleetRevenue: number;
  contribution: number;
  contributionRatio: number | null;
  depreciation: number;
  unassignedRevenue: number;
  companyCosts: number;
  operatingProfit: number;
  rentedDays: number;
  revenueDays: number;
  availableDays: number;
  serviceDays: number;
  occupancy: number | null;
  adr: number | null;
  revenuePerCarMonth: number | null;
  fixedPerCarMonth: number | null;
  breakEvenDays: number | null;
  discountRate: number | null;
  unregistered: number;
};

const ratio = (part: number, whole: number) => (whole > 0 ? part / whole : null);

export function period(rows: PnlRow[], vehicles: FleetVehicle[]): Period {
  const byVehicle = new Map<string, PnlRow[]>();
  const rest: PnlRow[] = [];
  const ids = new Set(vehicles.map((vehicle) => vehicle.id));
  for (const row of rows) {
    if (row.group_key && ids.has(row.group_key)) byVehicle.set(row.group_key, [...(byVehicle.get(row.group_key) ?? []), row]);
    else rest.push(row);
  }
  const vehicleRows = vehicles.map((vehicle): VehicleRow => {
    const sum = totals(byVehicle.get(vehicle.id) ?? []);
    const depreciation = depreciationCents(vehicle);
    const availableDays = Math.max(0, vehicle.serviceDays - vehicle.downDays);
    return {
      vehicle,
      totals: sum,
      revenue: sum.revenue,
      ownerShare: sum.owner,
      costs: sum.orderCosts + sum.expenses - sum.recoveries,
      depreciation,
      contribution: sum.net - depreciation,
      availableDays,
      occupancy: ratio(vehicle.rentedDays, availableDays),
    };
  });
  const all = totals(rows);
  const other = totals(rest);
  const add = (pick: (row: VehicleRow) => number) => vehicleRows.reduce((sum, row) => sum + pick(row), 0);
  const fleetRevenue = add((row) => row.revenue);
  const depreciation = add((row) => row.depreciation);
  const contribution = add((row) => row.contribution);
  const rentedDays = add((row) => row.vehicle.rentedDays);
  const revenueDays = add((row) => row.vehicle.revenueDays);
  const availableDays = add((row) => row.availableDays);
  const serviceDays = add((row) => row.vehicle.serviceDays);
  const carMonths = serviceDays / MONTH_DAYS;
  const netRent = add((row) => row.totals.rent - row.totals.discounts);
  const registered = vehicleRows.filter((row) => hasFixedCosts(row.vehicle) && row.vehicle.serviceDays > 0);
  const registeredDays = registered.reduce((sum, row) => sum + row.vehicle.serviceDays, 0);
  const fixedPerCarMonth = registeredDays > 0 ? registered.reduce((sum, row) => sum + fixedMonthlyCents(row.vehicle) * row.vehicle.serviceDays, 0) / registeredDays : null;
  const variable = add((row) => row.totals.net + row.totals.fixedExpenses);
  const perDay = revenueDays > 0 ? variable / revenueDays : null;
  return {
    all,
    rows: vehicleRows,
    fleetRevenue,
    contribution,
    contributionRatio: fleetRevenue > 0 ? contribution / fleetRevenue : null,
    depreciation,
    unassignedRevenue: other.revenue,
    companyCosts: other.owner + other.orderCosts + other.expenses - other.recoveries,
    operatingProfit: all.net - depreciation,
    rentedDays,
    revenueDays,
    availableDays,
    serviceDays,
    occupancy: ratio(rentedDays, availableDays),
    adr: revenueDays > 0 ? netRent / revenueDays : null,
    revenuePerCarMonth: carMonths > 0 ? fleetRevenue / carMonths : null,
    fixedPerCarMonth,
    breakEvenDays: fixedPerCarMonth !== null && perDay !== null && perDay > 0 ? fixedPerCarMonth / perDay : null,
    discountRate: ratio(all.discounts, all.gross),
    unregistered: vehicles.filter((vehicle) => !vehicle.inServiceOn).length,
  };
}

export type Change = { kind: "pct" | "pp"; value: number } | null;

export function moneyChange(current: number, previous: number): Change {
  if (previous === 0) return null;
  return { kind: "pct", value: (current - previous) / Math.abs(previous) };
}

export function rateChange(current: number | null, previous: number | null): Change {
  if (current === null || previous === null) return null;
  return { kind: "pp", value: current - previous };
}

export type CashView = {
  stripe: number;
  transit: number;
  bank: number | null;
  bankAsOf: string | null;
  total: number;
  burn: number | null;
  runwayMonths: number | null;
  receivable: number;
  receivableOrders: number;
  overdueDays: number;
  prepaid: number;
  credits: number;
  ownersPayable: number;
  ownersNextDue: string | null;
  pendingWithdrawals: number;
  holds: number;
  holdCount: number;
  pending: number;
};

export function cashView(cash: CashReport, asOf: string): CashView {
  const balance = (code: string) => Number(cash.accounts[code] ?? 0);
  const stripe = balance("1050");
  const transit = balance("1060");
  const bank = cash.bank.accounts > 0 ? Number(cash.bank.total) : null;
  const total = stripe + transit + (bank ?? 0);
  const enough = cash.firstDate !== null && cash.firstDate <= shiftMonths(`${monthOf(asOf)}-01`, -3) && cash.flows.length === 3;
  const average = enough ? cash.flows.reduce((sum, flow) => sum + Number(flow.net), 0) / 3 : null;
  const burn = average !== null && average < 0 ? -average : null;
  const dues = [cash.owners.oldest, cash.owners.nextSettle].filter((value): value is string => Boolean(value)).map((value) => laDate(value));
  return {
    stripe,
    transit,
    bank,
    bankAsOf: cash.bank.oldest,
    total,
    burn,
    runwayMonths: burn ? Math.max(0, total) / burn : null,
    receivable: Number(cash.orders.receivable),
    receivableOrders: Number(cash.orders.receivableOrders),
    overdueDays: Number(cash.orders.overdueDays),
    prepaid: Number(cash.orders.prepaid),
    credits: Number(cash.orders.credits) - balance("2920"),
    ownersPayable: 0 - (balance("2200") + balance("2210") + balance("2300") + balance("2310")),
    ownersNextDue: dues.sort()[0] ?? null,
    pendingWithdrawals: Number(cash.owners.cents),
    holds: Number(cash.holds.cents),
    holdCount: Number(cash.holds.count),
    pending: Number(cash.pending.exceptions) + Number(cash.pending.approvals) + Number(cash.pending.due ?? 0),
  };
}

export const CHANNELS = ["WEB", "STAFF", "PHONE", "WECHAT"] as const;

export type ChannelRow = { source: string | null; revenue: number; orders: number; days: number };

export function channelRows(rows: PnlRow[], fleet: Fleet["channels"]): ChannelRow[] {
  const revenue = new Map<string | null, PnlRow[]>();
  for (const row of rows) {
    const key = CHANNELS.includes(row.group_key as (typeof CHANNELS)[number]) ? row.group_key : null;
    revenue.set(key, [...(revenue.get(key) ?? []), row]);
  }
  const stats = new Map<string | null, { orders: number; days: number }>();
  for (const row of fleet) {
    const key = CHANNELS.includes(row.source as (typeof CHANNELS)[number]) ? row.source : null;
    const before = stats.get(key) ?? { orders: 0, days: 0 };
    stats.set(key, { orders: before.orders + Number(row.orders), days: before.days + Number(row.days) });
  }
  const build = (source: string | null): ChannelRow => ({ source, revenue: totals(revenue.get(source) ?? []).revenue, orders: stats.get(source)?.orders ?? 0, days: stats.get(source)?.days ?? 0 });
  const result = CHANNELS.map((source) => build(source));
  const other = build(null);
  return other.revenue !== 0 || other.orders > 0 ? [...result, other] : result;
}

export type StoreRow = { locationId: string | null; revenue: number; costs: number; contribution: number };

export function storeRows(rows: PnlRow[], locationIds: string[]): StoreRow[] {
  const known = new Set(locationIds);
  const grouped = new Map<string | null, PnlRow[]>();
  for (const row of rows) {
    const key = row.group_key && known.has(row.group_key) ? row.group_key : null;
    grouped.set(key, [...(grouped.get(key) ?? []), row]);
  }
  const build = (key: string | null): StoreRow => {
    const sum = totals(grouped.get(key) ?? []);
    return { locationId: key, revenue: sum.revenue, costs: sum.owner + sum.orderCosts + sum.expenses - sum.recoveries, contribution: sum.net };
  };
  const used = (row: StoreRow) => row.revenue !== 0 || row.costs !== 0;
  return [...locationIds.map(build), build(null)].filter(used);
}

export type ClassRow = { classId: string | null; name: string; nameZh: string; revenue: number; rentedDays: number; availableDays: number; occupancy: number | null; vehicles: number };

export function classRows(rows: VehicleRow[]): ClassRow[] {
  const map = new Map<string, ClassRow>();
  for (const row of rows) {
    const key = row.vehicle.classId ?? "";
    const entry = map.get(key) ?? { classId: row.vehicle.classId, name: row.vehicle.className ?? "—", nameZh: row.vehicle.classNameZh ?? row.vehicle.className ?? "—", revenue: 0, rentedDays: 0, availableDays: 0, occupancy: null, vehicles: 0 };
    entry.revenue += row.revenue;
    entry.rentedDays += row.vehicle.rentedDays;
    entry.availableDays += row.availableDays;
    entry.vehicles += 1;
    map.set(key, entry);
  }
  return [...map.values()].map((entry) => ({ ...entry, occupancy: ratio(entry.rentedDays, entry.availableDays) })).sort((a, b) => b.revenue - a.revenue || a.name.localeCompare(b.name));
}

export type Breakdown = Array<{ account: string; name_zh: string; name_en: string; cents: number }>;

export function breakdown(rows: PnlRow[], kinds: string[], sign: 1 | -1): Breakdown {
  const map = new Map<string, Breakdown[number]>();
  for (const row of rows) {
    if (!kinds.includes(row.kind)) continue;
    const entry = map.get(row.account) ?? { account: row.account, name_zh: row.name_zh, name_en: row.name_en, cents: 0 };
    entry.cents += sign * (Number(row.credit_cents) - Number(row.debit_cents));
    map.set(row.account, entry);
  }
  return [...map.values()].filter((entry) => entry.cents !== 0).sort((a, b) => a.account.localeCompare(b.account));
}
