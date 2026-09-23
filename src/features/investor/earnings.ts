import "server-only";
import { classImage, listVehicleMedia } from "@/features/portal/garage";
import { listAllocations, type Allocation } from "./contributions";
import { holdFor, holdsAffecting, type Hold, type HoldMap } from "./holds";
import { ledgerQuery, memberEntryColumns, type LedgerEntry } from "./ledger";
import { loadAssetStats, monthBounds, rentedDaysByVehicle, type AssetStats } from "./stats";

const shareTypes = ["RENTAL_SHARE", "MILEAGE_FEE", "ADJUSTMENT", "REVERSAL"] as const;
const entryColumns = "id, investor_id, type, bucket, amount_cents, settles_at, settled_at, reservation_id, vehicle_id, allocation_id, contribution_id, withdrawal_id, reversal_of, memo, metadata, created_at, reservation:reservations(number, pickup_at, return_at), vehicle:vehicles(fleet_number)";

export type ShareEntry = LedgerEntry & { reservation: { number: string; pickup_at: string; return_at: string } | null };

export async function monthShareEntries(investorId: string, month: string, memberId?: string | null): Promise<ShareEntry[]> {
  const { start, end } = monthBounds(month);
  const { data } = await ledgerQuery(memberId ? `${entryColumns}, ${memberEntryColumns}` : entryColumns, { investorId, memberId })
    .in("type", [...shareTypes])
    .not("vehicle_id", "is", null)
    .gte("created_at", start.toISOString())
    .lt("created_at", end.toISOString())
    .order("created_at");
  return (data ?? []) as unknown as ShareEntry[];
}

export type EarningRow = {
  allocation: Allocation;
  className: string;
  cover: string;
  rentalCents: number;
  discountCents: number;
  baseCents: number;
  shareCents: number;
  pendingCents: number;
  settledCents: number;
  heldCents: number;
  nextSettlesAt: string | null;
  hold: Hold | null;
};

export type MonthEarnings = { rows: EarningRow[]; entries: ShareEntry[]; holds: HoldMap; totals: { rentalCents: number; discountCents: number; baseCents: number; shareCents: number; pendingCents: number; settledCents: number; heldCents: number } };

const meta = (entry: LedgerEntry, key: string) => {
  const value = Number((entry.metadata as Record<string, unknown>)[key] ?? 0) || 0;
  return entry.ratio === undefined ? value : Math.round(value * Number(entry.ratio));
};

export const entryBase = (entry: LedgerEntry) => (entry.ratio === undefined ? Number((entry.metadata as Record<string, unknown>).baseCents ?? 0) || 0 : Math.max(0, meta(entry, "rentalCents") - meta(entry, "discountCents")));

export function baseReduction(entry: LedgerEntry, allocation: Allocation | undefined) {
  if (entry.type !== "ADJUSTMENT" || (entry.metadata as Record<string, unknown>).source !== "refund" || !allocation) return 0;
  const factor = (allocation.revenue_share_bps / 10000) * (allocation.share_bps / 10000);
  return factor > 0 ? Math.round(-entry.amount_cents / factor) : 0;
}

export async function monthEarnings(investorId: string, month: string, locale: string, memberId?: string | null): Promise<MonthEarnings> {
  const allocations = await listAllocations(investorId);
  const vehicleIds = [...new Set(allocations.map((item) => item.vehicle_id))];
  const [entries, holds, media] = await Promise.all([monthShareEntries(investorId, month, memberId), holdsAffecting(investorId, vehicleIds), listVehicleMedia(vehicleIds)]);
  const byAllocation = new Map<string, Allocation>(allocations.map((item) => [item.id, item]));
  const rows: EarningRow[] = [];
  for (const allocation of allocations) {
    const own = entries.filter((entry) => entry.allocation_id === allocation.id || (!entry.allocation_id && entry.vehicle_id === allocation.vehicle_id));
    if (own.length === 0 && allocation.status === "ENDED") continue;
    const rentalCents = own.reduce((sum, entry) => sum + (entry.type === "RENTAL_SHARE" ? meta(entry, "rentalCents") : 0), 0);
    const discountCents = own.reduce((sum, entry) => sum + (entry.type === "RENTAL_SHARE" ? meta(entry, "discountCents") : baseReduction(entry, byAllocation.get(entry.allocation_id ?? ""))), 0);
    const shareCents = own.reduce((sum, entry) => sum + entry.amount_cents, 0);
    const pending = own.filter((entry) => entry.bucket === "PENDING");
    const held = pending.filter((entry) => holdFor(holds, entry));
    const free = pending.filter((entry) => !holdFor(holds, entry) && entry.settles_at);
    const image = (media[allocation.vehicle_id] ?? []).find((item) => item.kind === "IMAGE");
    rows.push({
      allocation,
      className: (locale === "zh" ? (allocation.vehicle?.vehicle_class?.name_zh ?? allocation.vehicle?.vehicle_class?.name) : allocation.vehicle?.vehicle_class?.name) ?? "",
      cover: image?.url ?? classImage(allocation.vehicle?.vehicle_class?.slug),
      rentalCents,
      discountCents,
      baseCents: Math.max(0, rentalCents - discountCents),
      shareCents,
      pendingCents: pending.reduce((sum, entry) => sum + entry.amount_cents, 0),
      settledCents: own.filter((entry) => entry.bucket === "AVAILABLE").reduce((sum, entry) => sum + entry.amount_cents, 0),
      heldCents: held.reduce((sum, entry) => sum + entry.amount_cents, 0),
      nextSettlesAt: free.map((entry) => entry.settles_at as string).sort()[0] ?? null,
      hold: held.map((entry) => holdFor(holds, entry)).find(Boolean) ?? null,
    });
  }
  const totals = rows.reduce(
    (acc, row) => ({ rentalCents: acc.rentalCents + row.rentalCents, discountCents: acc.discountCents + row.discountCents, baseCents: acc.baseCents + row.baseCents, shareCents: acc.shareCents + row.shareCents, pendingCents: acc.pendingCents + row.pendingCents, settledCents: acc.settledCents + row.settledCents, heldCents: acc.heldCents + row.heldCents }),
    { rentalCents: 0, discountCents: 0, baseCents: 0, shareCents: 0, pendingCents: 0, settledCents: 0, heldCents: 0 },
  );
  return { rows, entries, holds, totals };
}

export type TrendPoint = { month: string; settledCents: number; pendingCents: number };

export function monthsBack(endMonth: string, count: number) {
  const [y, m] = endMonth.split("-").map(Number);
  const months: string[] = [];
  for (let i = count - 1; i >= 0; i -= 1) {
    const date = new Date(Date.UTC(y, m - 1 - i, 1));
    months.push(`${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`);
  }
  return months;
}

export async function trend(investorId: string, endMonth: string, count = 6, memberId?: string | null): Promise<TrendPoint[]> {
  const months = monthsBack(endMonth, count);
  const { start } = monthBounds(months[0]);
  const { end } = monthBounds(endMonth);
  const { data } = await ledgerQuery("amount_cents, bucket, created_at", { investorId, memberId }).in("type", [...shareTypes]).gte("created_at", start.toISOString()).lt("created_at", end.toISOString());
  const entries = (data ?? []) as unknown as Array<{ amount_cents: number; bucket: string; created_at: string }>;
  const key = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit" }).format(new Date(iso)).slice(0, 7);
  return months.map((month) => {
    const rows = entries.filter((row) => key(row.created_at) === month);
    return { month, settledCents: rows.filter((row) => row.bucket === "AVAILABLE").reduce((sum, row) => sum + row.amount_cents, 0), pendingCents: rows.filter((row) => row.bucket === "PENDING").reduce((sum, row) => sum + row.amount_cents, 0) };
  });
}

export async function listEarningMonths(investorId: string, memberId?: string | null): Promise<string[]> {
  const { data } = await ledgerQuery("created_at", { investorId, memberId }).in("type", [...shareTypes]).order("created_at", { ascending: false }).limit(2000);
  const key = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit" }).format(new Date(iso)).slice(0, 7);
  return [...new Set(((data ?? []) as unknown as Array<{ created_at: string }>).map((row) => key(row.created_at)))];
}

export type DashboardSummary = { monthShareCents: number; nextSettlement: { at: string; amountCents: number } | null; heldPendingCents: number; settledTotalCents: number; rentedDays: number; availableDays: number; utilization: number | null; stats: Record<string, AssetStats> };

export async function dashboardSummary(investorId: string, allocations: Allocation[], month: string, memberId?: string | null): Promise<DashboardSummary> {
  const vehicleIds = allocations.map((item) => item.vehicle_id);
  const [monthEntries, settled, pending, holds, stats] = await Promise.all([
    monthShareEntries(investorId, month, memberId),
    ledgerQuery("amount_cents", { investorId, memberId }).in("type", [...shareTypes]).eq("bucket", "AVAILABLE"),
    ledgerQuery("id, vehicle_id, amount_cents, settles_at", { investorId, memberId }).eq("bucket", "PENDING").not("settles_at", "is", null),
    holdsAffecting(investorId, vehicleIds),
    loadAssetStats(allocations.filter((item) => item.status !== "ENDED"), month, memberId),
  ]);
  const settledRows = (settled.data ?? []) as unknown as Array<{ amount_cents: number }>;
  const pendingRows = (pending.data ?? []) as unknown as Array<{ id: string; vehicle_id: string | null; amount_cents: number; settles_at: string | null }>;
  const free = (pendingRows ?? []).filter((row) => !holdFor(holds, { id: row.id, vehicle_id: row.vehicle_id })).sort((a, b) => String(a.settles_at).localeCompare(String(b.settles_at)));
  const next = free[0];
  const nextSettlement = next ? { at: next.settles_at as string, amountCents: free.filter((row) => row.settles_at === next.settles_at).reduce((sum, row) => sum + row.amount_cents, 0) } : null;
  const rentedDays = Object.values(stats).reduce((sum, item) => sum + item.rentedDays, 0);
  const availableDays = Object.values(stats).reduce((sum, item) => sum + item.availableDays, 0);
  return {
    monthShareCents: monthEntries.reduce((sum, entry) => sum + entry.amount_cents, 0),
    nextSettlement,
    heldPendingCents: (pendingRows ?? []).filter((row) => holdFor(holds, { id: row.id, vehicle_id: row.vehicle_id })).reduce((sum, row) => sum + row.amount_cents, 0),
    settledTotalCents: (settledRows ?? []).reduce((sum, row) => sum + row.amount_cents, 0),
    rentedDays,
    availableDays,
    utilization: availableDays > 0 ? Math.min(100, Math.round((rentedDays / availableDays) * 100)) : null,
    stats,
  };
}

export type AllocationMonth = { entries: ShareEntry[]; baseCents: number; shareCents: number; rentedDays: Set<string>; maintenanceDays: Set<string>; stats: AssetStats | undefined; settledTotalCents: number; holds: HoldMap };

export async function allocationMonth(allocation: Allocation, month: string, memberId?: string | null): Promise<AllocationMonth> {
  const [entries, usage, stats, settled, holds] = await Promise.all([
    monthShareEntries(allocation.investor_id, month, memberId),
    rentedDaysByVehicle([allocation.vehicle_id], month),
    loadAssetStats([allocation], month, memberId),
    ledgerQuery("amount_cents", { memberId }).eq("allocation_id", allocation.id).in("type", [...shareTypes]).eq("bucket", "AVAILABLE"),
    holdsAffecting(allocation.investor_id, [allocation.vehicle_id]),
  ]);
  const settledRows = (settled.data ?? []) as unknown as Array<{ amount_cents: number }>;
  const own = entries.filter((entry) => entry.allocation_id === allocation.id);
  const rental = own.reduce((sum, entry) => sum + (entry.type === "RENTAL_SHARE" ? meta(entry, "rentalCents") : 0), 0);
  const discount = own.reduce((sum, entry) => sum + (entry.type === "RENTAL_SHARE" ? meta(entry, "discountCents") : baseReduction(entry, allocation)), 0);
  return {
    entries: own,
    baseCents: Math.max(0, rental - discount),
    shareCents: own.reduce((sum, entry) => sum + entry.amount_cents, 0),
    rentedDays: usage[allocation.vehicle_id]?.rented ?? new Set(),
    maintenanceDays: usage[allocation.vehicle_id]?.maintenance ?? new Set(),
    stats: stats[allocation.id],
    settledTotalCents: (settledRows ?? []).reduce((sum, row) => sum + row.amount_cents, 0),
    holds,
  };
}

export function monthLabel(month: string, locale: string) {
  const [y, m] = month.split("-").map(Number);
  return new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en-US", { year: "numeric", month: "long", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, 1)));
}

export function shortMonth(month: string, locale: string) {
  const [y, m] = month.split("-").map(Number);
  return new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en-US", { month: "short", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, 1)));
}

export const isMonth = (value: unknown): value is string => typeof value === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
