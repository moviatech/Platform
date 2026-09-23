import "server-only";
import { zonedParts } from "@/features/booking/time";
import { teslaReady } from "@/features/tesla/service";
import { audit } from "@/lib/audit";
import { createAdminClient } from "@/lib/supabase/admin";
import { TeslaError, vehicleSnapshot } from "@/lib/tesla/client";
import { formatMoney } from "@/lib/utils/format";
import { businessDaysAfter, LedgerError, loadBalances, postEntries, type EntryInput } from "./ledger";
import { notifyInvestorEvent, notifyStaffInvestorEvent } from "./notify";
import { loadInvestorSettings } from "./settings";
import { monthBounds } from "./stats";

export const compensations = ["REVENUE_SHARE", "PER_MILE"] as const;
export type Compensation = (typeof compensations)[number];
export const odometerSources = ["DELIVERY", "TESLA", "PICKUP", "RETURN", "MANUAL", "SERVICE"] as const;
export type OdometerSource = (typeof odometerSources)[number];
export const statementStatuses = ["DRAFT", "ISSUED", "DISPUTED", "SETTLED", "VOID"] as const;
export type StatementStatus = (typeof statementStatuses)[number];
export const adjustmentKinds = ["OWNER_USE", "REPOSITIONING", "ODOMETER_ERROR", "FRAUD", "DISPUTE", "OTHER"] as const;
export type AdjustmentKind = (typeof adjustmentKinds)[number];

type Actor = { userId: string; displayName: string } | null;

export type OdometerReading = { id: string; vehicle_id: string; reading: number; source: OdometerSource; read_at: string; reservation_id: string | null; statement_id: string | null; note: string | null; created_at: string };
export type MileageRate = { id: string; investor_id: string; rate_cents: number; effective_month: string; created_at: string };
export type MileageAdjustment = { id: string; statement_id: string; miles: number; kind: AdjustmentKind; reason: string; created_at: string; author: { display_name: string } | null };

export type MileageStatement = {
  id: string;
  investor_id: string;
  allocation_id: string;
  vehicle_id: string;
  month: string;
  period_start: string;
  period_end: string;
  start_reading: number | null;
  end_reading: number | null;
  start_source: OdometerSource | null;
  end_source: OdometerSource | null;
  adjustment_miles: number;
  qualifying_miles: number;
  rate_cents: number;
  amount_cents: number;
  status: StatementStatus;
  final: boolean;
  read_error: string | null;
  issued_at: string | null;
  dispute_until: string | null;
  disputed_at: string | null;
  disputed_miles: number;
  dispute_note: string | null;
  resolved_at: string | null;
  accepted_miles: number | null;
  resolution_note: string | null;
  entry_id: string | null;
  disputed_entry_id: string | null;
  created_at: string;
  vehicle: { fleet_number: string; vin: string | null; vehicle_class: { slug: string; name: string; name_zh: string | null } | null } | null;
  investor: { id: string; legal_name: string; investor_number: string; preferred_language: string } | null;
  adjustments: MileageAdjustment[];
};

const zone = "America/Los_Angeles";
const readingColumns = "id, vehicle_id, reading, source, read_at, reservation_id, statement_id, note, created_at";
const statementColumns =
  "id, investor_id, allocation_id, vehicle_id, month, period_start, period_end, start_reading, end_reading, start_source, end_source, adjustment_miles, qualifying_miles, rate_cents, amount_cents, status, final, read_error, issued_at, dispute_until, disputed_at, disputed_miles, dispute_note, resolved_at, accepted_miles, resolution_note, entry_id, disputed_entry_id, created_at, vehicle:vehicles(fleet_number, vin, vehicle_class:vehicle_classes(slug, name, name_zh)), investor:investors(id, legal_name, investor_number, preferred_language), adjustments:investor_mileage_adjustments(id, statement_id, miles, kind, reason, created_at, author:staff_members!investor_mileage_adjustments_created_by_fkey(display_name))";

export const monthKey = (statement: { month: string }) => statement.month.slice(0, 7);
export const monthStartDate = (month: string) => `${month}-01`;
export const isMonthKey = (value: unknown): value is string => typeof value === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);

export function previousMonth(month: string) {
  const [y, m] = month.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 2, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

const liveReadWindow = 4 * 86400000;
const dayStart = (date: string) => new Date(`${date}T08:00:00Z`);
const dayEnd = (date: string) => new Date(dayStart(date).getTime() + 86400000);

export function computeMiles(statement: { start_reading: number | null; end_reading: number | null; adjustment_miles: number; rate_cents: number }) {
  const gross = statement.start_reading !== null && statement.end_reading !== null ? Math.max(0, statement.end_reading - statement.start_reading) : 0;
  const qualifying = Math.max(0, gross + statement.adjustment_miles);
  return { gross, qualifying, amount: qualifying * statement.rate_cents };
}

export async function recordReading(input: { vehicleId: string; reading: number; source: OdometerSource; readAt?: string; reservationId?: string | null; statementId?: string | null; note?: string | null; createdBy?: string | null }) {
  const { data } = await createAdminClient()
    .from("vehicle_odometer_readings")
    .insert({ vehicle_id: input.vehicleId, reading: Math.round(input.reading), source: input.source, read_at: input.readAt ?? new Date().toISOString(), reservation_id: input.reservationId ?? null, statement_id: input.statementId ?? null, note: input.note ?? null, created_by: input.createdBy ?? null })
    .select("id")
    .single();
  return (data?.id as string | undefined) ?? null;
}

export async function readingAt(vehicleId: string, instant: string): Promise<OdometerReading | null> {
  const { data } = await createAdminClient().from("vehicle_odometer_readings").select(readingColumns).eq("vehicle_id", vehicleId).lte("read_at", instant).order("read_at", { ascending: false }).order("created_at", { ascending: false }).limit(1).maybeSingle();
  return (data as OdometerReading | null) ?? null;
}

export async function listReadings(vehicleId: string, limit = 12): Promise<OdometerReading[]> {
  const { data } = await createAdminClient().from("vehicle_odometer_readings").select(readingColumns).eq("vehicle_id", vehicleId).order("read_at", { ascending: false }).limit(limit);
  return (data ?? []) as OdometerReading[];
}

export async function listRates(investorId: string): Promise<MileageRate[]> {
  const { data } = await createAdminClient().from("investor_mileage_rates").select("id, investor_id, rate_cents, effective_month, created_at").eq("investor_id", investorId).order("effective_month", { ascending: false });
  return (data ?? []) as MileageRate[];
}

export async function rateFor(investorId: string, month: string) {
  const rates = () => createAdminClient().from("investor_mileage_rates").select("rate_cents").eq("investor_id", investorId);
  const { data } = await rates().lte("effective_month", monthStartDate(month)).order("effective_month", { ascending: false }).limit(1).maybeSingle();
  if (data) return data.rate_cents as number;
  const { data: first } = await createAdminClient().from("investor_mileage_rates").select("rate_cents, effective_month, created_at").eq("investor_id", investorId).order("effective_month", { ascending: true }).limit(1).maybeSingle();
  if (first && String(first.effective_month).slice(0, 7) <= zonedParts(first.created_at as string, zone).date.slice(0, 7)) return first.rate_cents as number;
  return (await loadInvestorSettings()).mileageRateCents;
}

export async function currentRate(investorId: string) {
  return rateFor(investorId, zonedParts(new Date(), zone).date.slice(0, 7));
}

export async function setRate(investorId: string, rateCents: number, effectiveMonth: string, actor: Actor) {
  const { error } = await createAdminClient().from("investor_mileage_rates").upsert({ investor_id: investorId, rate_cents: rateCents, effective_month: monthStartDate(effectiveMonth), created_by: actor?.userId ?? null }, { onConflict: "investor_id,effective_month" });
  if (error) throw new Error(error.message);
  await audit({ actorUserId: actor?.userId, actorType: actor ? "STAFF" : "SYSTEM", action: "investor.mileage_rate_set", entityType: "investor", entityId: investorId, metadata: { by: actor?.displayName, rateCents, effectiveMonth } });
}

async function payoutDaysFor(investorId: string) {
  const [{ data }, settings] = await Promise.all([createAdminClient().from("investors").select("mileage_payout_days").eq("id", investorId).maybeSingle(), loadInvestorSettings()]);
  return (data?.mileage_payout_days as number | null | undefined) ?? settings.mileagePayoutDays;
}

export async function readTeslaOdometer(vehicleId: string) {
  const { data: vehicle } = await createAdminClient().from("vehicles").select("vin").eq("id", vehicleId).maybeSingle();
  if (!vehicle?.vin) throw new TeslaError("no_vin");
  if (!(await teslaReady())) throw new TeslaError("not_connected");
  const snapshot = await vehicleSnapshot(vehicle.vin, { wake: true });
  if (snapshot.odometer === null) throw new TeslaError("no_odometer");
  return snapshot.odometer;
}

export async function bumpVehicleOdometer(vehicleId: string, reading: number) {
  await createAdminClient().from("vehicles").update({ odometer: reading }).eq("id", vehicleId).or(`odometer.is.null,odometer.lt.${reading}`);
}

export async function getStatement(id: string): Promise<MileageStatement | null> {
  const { data } = await createAdminClient().from("investor_mileage_statements").select(statementColumns).eq("id", id).maybeSingle();
  const statement = data as unknown as MileageStatement | null;
  if (statement) statement.adjustments = [...(statement.adjustments ?? [])].sort((a, b) => a.created_at.localeCompare(b.created_at));
  return statement ?? null;
}

export async function listStatements(options: { month?: string; investorId?: string; allocationId?: string; statuses?: StatementStatus[]; limit?: number } = {}): Promise<MileageStatement[]> {
  let query = createAdminClient().from("investor_mileage_statements").select(statementColumns).order("month", { ascending: false }).order("created_at", { ascending: false }).limit(options.limit ?? 200);
  if (options.month) query = query.eq("month", monthStartDate(options.month));
  if (options.investorId) query = query.eq("investor_id", options.investorId);
  if (options.allocationId) query = query.eq("allocation_id", options.allocationId);
  if (options.statuses?.length) query = query.in("status", options.statuses);
  else query = query.neq("status", "VOID");
  const { data } = await query;
  return ((data ?? []) as unknown as MileageStatement[]).map((statement) => ({ ...statement, adjustments: [...(statement.adjustments ?? [])].sort((a, b) => a.created_at.localeCompare(b.created_at)) }));
}

export async function countOpenStatements() {
  const { count } = await createAdminClient().from("investor_mileage_statements").select("id", { count: "exact", head: true }).in("status", ["DRAFT", "DISPUTED"]);
  return count ?? 0;
}

export async function listStatementMonths(investorId?: string): Promise<string[]> {
  let query = createAdminClient().from("investor_mileage_statements").select("month").neq("status", "VOID").order("month", { ascending: false }).limit(2000);
  if (investorId) query = query.eq("investor_id", investorId);
  const { data } = await query;
  return [...new Set((data ?? []).map((row) => String(row.month).slice(0, 7)))];
}

export async function latestStatements(investorId: string): Promise<Record<string, MileageStatement>> {
  const rows = await listStatements({ investorId, statuses: ["ISSUED", "DISPUTED", "SETTLED"], limit: 500 });
  const result: Record<string, MileageStatement> = {};
  for (const row of rows) if (!result[row.allocation_id]) result[row.allocation_id] = row;
  return result;
}

async function recalc(id: string) {
  const supabase = createAdminClient();
  const [{ data: row }, { data: adjustments }] = await Promise.all([
    supabase.from("investor_mileage_statements").select("start_reading, end_reading, rate_cents").eq("id", id).maybeSingle(),
    supabase.from("investor_mileage_adjustments").select("miles").eq("statement_id", id),
  ]);
  if (!row) return null;
  const adjustmentMiles = (adjustments ?? []).reduce((sum, item) => sum + item.miles, 0);
  const miles = computeMiles({ start_reading: row.start_reading, end_reading: row.end_reading, adjustment_miles: adjustmentMiles, rate_cents: row.rate_cents });
  await supabase.from("investor_mileage_statements").update({ adjustment_miles: adjustmentMiles, qualifying_miles: miles.qualifying, amount_cents: miles.amount }).eq("id", id);
  return miles;
}

type BuildOptions = { final?: boolean; periodEnd?: Date; endReading?: { reading: number; source: OdometerSource; note?: string | null } | null; actor?: Actor; issue?: boolean };
type AllocationLike = { id: string; investor_id: string; vehicle_id: string; effective_from: string; effective_to: string | null };

export async function buildStatement(allocation: AllocationLike, month: string, options: BuildOptions = {}): Promise<MileageStatement | null> {
  const supabase = createAdminClient();
  const { start: monthStart, end: monthEnd } = monthBounds(month);
  const periodStart = new Date(Math.max(monthStart.getTime(), dayStart(allocation.effective_from).getTime()));
  const periodEnd = options.periodEnd ?? (allocation.effective_to ? new Date(Math.min(monthEnd.getTime(), dayEnd(allocation.effective_to).getTime())) : monthEnd);
  if (periodEnd.getTime() <= periodStart.getTime()) return null;
  const { data: existing } = await supabase.from("investor_mileage_statements").select("id").eq("allocation_id", allocation.id).eq("month", monthStartDate(month)).neq("status", "VOID").maybeSingle();
  if (existing) return null;
  const [rate, startReading] = await Promise.all([rateFor(allocation.investor_id, month), readingAt(allocation.vehicle_id, periodStart.toISOString())]);
  let end = options.endReading ?? null;
  let readError: string | null = null;
  const late = !end && Date.now() - periodEnd.getTime() > liveReadWindow;
  if (late) {
    const stored = await readingAt(allocation.vehicle_id, periodEnd.toISOString());
    if (stored && Date.parse(stored.read_at) > periodStart.getTime()) end = { reading: stored.reading, source: stored.source, note: stored.read_at };
    else readError = "no_end";
  } else if (!end) {
    try {
      end = { reading: await readTeslaOdometer(allocation.vehicle_id), source: "TESLA", note: new Date().toISOString() };
    } catch (cause) {
      readError = cause instanceof TeslaError ? cause.code : "failed";
    }
  }
  const miles = computeMiles({ start_reading: startReading?.reading ?? null, end_reading: end?.reading ?? null, adjustment_miles: 0, rate_cents: rate });
  const { data: created, error } = await supabase
    .from("investor_mileage_statements")
    .insert({
      investor_id: allocation.investor_id,
      allocation_id: allocation.id,
      vehicle_id: allocation.vehicle_id,
      month: monthStartDate(month),
      period_start: periodStart.toISOString(),
      period_end: periodEnd.toISOString(),
      start_reading: startReading?.reading ?? null,
      start_source: startReading?.source ?? null,
      end_reading: end?.reading ?? null,
      end_source: end?.source ?? null,
      qualifying_miles: miles.qualifying,
      amount_cents: miles.amount,
      rate_cents: rate,
      final: options.final ?? false,
      read_error: readError ?? (startReading ? null : "no_start"),
    })
    .select("id")
    .single();
  if (error || !created) {
    if (/investor_mileage_statements_period_idx/.test(error?.message ?? "")) return null;
    throw new Error(error?.message ?? "statement_failed");
  }
  if (end) {
    await recordReading({ vehicleId: allocation.vehicle_id, reading: end.reading, source: end.source, readAt: periodEnd.toISOString(), statementId: created.id, note: end.note ?? null, createdBy: options.actor?.userId ?? null });
    if (end.source === "TESLA") await bumpVehicleOdometer(allocation.vehicle_id, end.reading);
  }
  await audit({ actorUserId: options.actor?.userId, actorType: options.actor ? "STAFF" : "SYSTEM", action: "investor.statement_created", entityType: "investor_mileage_statement", entityId: created.id, metadata: { investorId: allocation.investor_id, allocationId: allocation.id, month, startReading: startReading?.reading ?? null, endReading: end?.reading ?? null, readError, final: options.final ?? false } });
  if (options.issue !== false && !late && startReading && end) return issueStatement(created.id, options.actor ?? null);
  return getStatement(created.id);
}

export async function issueStatement(id: string, actor: Actor): Promise<MileageStatement | null> {
  const statement = await getStatement(id);
  if (!statement || statement.status !== "DRAFT" || statement.start_reading === null || statement.end_reading === null) return statement;
  const miles = computeMiles(statement);
  const days = await payoutDaysFor(statement.investor_id);
  const settlesAt = businessDaysAfter(new Date(statement.period_end), days).toISOString();
  const key = monthKey(statement);
  let entryId: string | null = null;
  if (miles.amount > 0) {
    [entryId] = await postEntries(statement.investor_id, [
      {
        type: "MILEAGE_FEE",
        bucket: "PENDING",
        amountCents: miles.amount,
        settlesAt,
        vehicleId: statement.vehicle_id,
        allocationId: statement.allocation_id,
        statementId: id,
        memo: `${key} · ${statement.vehicle?.fleet_number ?? ""}`.trim(),
        metadata: { month: key, startReading: statement.start_reading, endReading: statement.end_reading, qualifyingMiles: miles.qualifying, rateCents: statement.rate_cents, final: statement.final },
        createdBy: actor?.userId ?? null,
      },
    ]);
  }
  const now = new Date();
  await createAdminClient()
    .from("investor_mileage_statements")
    .update({ status: "ISSUED", issued_at: now.toISOString(), issued_by: actor?.userId ?? null, dispute_until: new Date(now.getTime() + 7 * 86400000).toISOString(), entry_id: entryId, qualifying_miles: miles.qualifying, amount_cents: miles.amount, read_error: null })
    .eq("id", id)
    .eq("status", "DRAFT");
  await audit({ actorUserId: actor?.userId, actorType: actor ? "STAFF" : "SYSTEM", action: "investor.statement_issued", entityType: "investor_mileage_statement", entityId: id, metadata: { by: actor?.displayName, investorId: statement.investor_id, month: key, miles: miles.qualifying, amountCents: miles.amount, settlesAt } });
  await notifyInvestorEvent(statement.investor_id, "statement_issued", { month: key, vehicle: statement.vehicle?.fleet_number ?? "", miles: String(miles.qualifying), amount: formatMoney(miles.amount) }, `/earnings?month=${key}`, { dedupeKey: `statement_issued:${id}` });
  return getStatement(id);
}

async function entryBrief(id: string) {
  const { data } = await createAdminClient().from("investor_ledger_entries").select("id, bucket, amount_cents, settles_at").eq("id", id).maybeSingle();
  return (data as { id: string; bucket: string; amount_cents: number; settles_at: string | null } | null) ?? null;
}

async function postDelta(statement: MileageStatement, deltaCents: number, memo: string, actor: Actor) {
  if (deltaCents === 0) return;
  const entry = statement.entry_id ? await entryBrief(statement.entry_id) : null;
  const base: EntryInput = { type: "ADJUSTMENT", bucket: "PENDING", amountCents: deltaCents, vehicleId: statement.vehicle_id, allocationId: statement.allocation_id, statementId: statement.id, memo, metadata: { source: "statement" }, createdBy: actor?.userId ?? null };
  if (!entry || entry.bucket === "PENDING") {
    const settlesAt = entry?.settles_at ?? businessDaysAfter(new Date(statement.period_end), await payoutDaysFor(statement.investor_id)).toISOString();
    await postEntries(statement.investor_id, [{ ...base, settlesAt }]);
    return;
  }
  try {
    await postEntries(statement.investor_id, [{ ...base, bucket: "AVAILABLE", settlesAt: null }]);
  } catch (cause) {
    if (cause instanceof LedgerError && cause.message === "insufficient_available") await postEntries(statement.investor_id, [{ ...base, settlesAt: new Date().toISOString(), metadata: { source: "statement", deferred: true } }]);
    else throw cause;
  }
}

async function notifyRevised(statement: MileageStatement) {
  const fresh = await getStatement(statement.id);
  if (!fresh) return;
  const key = monthKey(fresh);
  await createAdminClient()
    .from("investor_mileage_statements")
    .update({ dispute_until: new Date(Math.max(Date.parse(fresh.dispute_until ?? "0"), Date.now() + 7 * 86400000)).toISOString() })
    .eq("id", fresh.id);
  await notifyInvestorEvent(fresh.investor_id, "statement_revised", { month: key, vehicle: fresh.vehicle?.fleet_number ?? "", miles: String(fresh.qualifying_miles), amount: formatMoney(fresh.amount_cents) }, `/earnings?month=${key}`);
}

export async function addAdjustment(statementId: string, input: { miles: number; kind: AdjustmentKind; reason: string }, actor: Actor) {
  const statement = await getStatement(statementId);
  if (!statement || (statement.status !== "DRAFT" && statement.status !== "ISSUED")) return { error: "status" as const };
  const { error } = await createAdminClient().from("investor_mileage_adjustments").insert({ statement_id: statementId, miles: input.miles, kind: input.kind, reason: input.reason, created_by: actor?.userId ?? null });
  if (error) return { error: "failed" as const };
  const miles = await recalc(statementId);
  await audit({ actorUserId: actor?.userId, actorType: actor ? "STAFF" : "SYSTEM", action: "investor.statement_adjusted", entityType: "investor_mileage_statement", entityId: statementId, metadata: { by: actor?.displayName, miles: input.miles, kind: input.kind, reason: input.reason } });
  if (statement.status === "ISSUED" && miles) {
    await postDelta(statement, miles.amount - statement.amount_cents, `${monthKey(statement)} · ${input.reason}`, actor);
    await notifyRevised(statement);
  }
  return { ok: true as const };
}

export async function removeAdjustment(adjustmentId: string, actor: Actor) {
  const supabase = createAdminClient();
  const { data: adjustment } = await supabase.from("investor_mileage_adjustments").select("id, statement_id, miles").eq("id", adjustmentId).maybeSingle();
  if (!adjustment) return { error: "status" as const };
  const { data: statement } = await supabase.from("investor_mileage_statements").select("status").eq("id", adjustment.statement_id).maybeSingle();
  if (statement?.status !== "DRAFT") return { error: "status" as const };
  await supabase.from("investor_mileage_adjustments").delete().eq("id", adjustmentId);
  await recalc(adjustment.statement_id);
  await audit({ actorUserId: actor?.userId, actorType: "STAFF", action: "investor.statement_adjustment_removed", entityType: "investor_mileage_statement", entityId: adjustment.statement_id, metadata: { by: actor?.displayName, miles: adjustment.miles } });
  return { ok: true as const };
}

export async function setReading(statementId: string, which: "start" | "end", reading: number, source: OdometerSource, actor: Actor, note?: string | null) {
  const statement = await getStatement(statementId);
  if (!statement || statement.status !== "DRAFT") return { error: "status" as const };
  const readAt = which === "start" ? statement.period_start : statement.period_end;
  await recordReading({ vehicleId: statement.vehicle_id, reading, source, readAt, statementId, note: note ?? null, createdBy: actor?.userId ?? null });
  const patch = which === "start" ? { start_reading: reading, start_source: source } : { end_reading: reading, end_source: source };
  const start = which === "start" ? reading : statement.start_reading;
  const end = which === "end" ? reading : statement.end_reading;
  const readError = start !== null && end !== null ? null : start === null ? "no_start" : statement.read_error;
  await createAdminClient().from("investor_mileage_statements").update({ ...patch, read_error: readError }).eq("id", statementId);
  await recalc(statementId);
  if (which === "end" && source === "TESLA") await bumpVehicleOdometer(statement.vehicle_id, reading);
  await audit({ actorUserId: actor?.userId, actorType: actor ? "STAFF" : "SYSTEM", action: "investor.statement_reading_set", entityType: "investor_mileage_statement", entityId: statementId, metadata: { by: actor?.displayName, which, reading, source } });
  return { ok: true as const };
}

export async function rereadStatement(statementId: string, actor: Actor) {
  const statement = await getStatement(statementId);
  if (!statement || statement.status !== "DRAFT") return { error: "status" as const };
  try {
    const reading = await readTeslaOdometer(statement.vehicle_id);
    return setReading(statementId, "end", reading, "TESLA", actor, new Date().toISOString());
  } catch (cause) {
    const code = cause instanceof TeslaError ? cause.code : "failed";
    await createAdminClient().from("investor_mileage_statements").update({ read_error: code }).eq("id", statementId);
    return { error: code };
  }
}

export async function voidStatement(statementId: string, actor: Actor) {
  const { data } = await createAdminClient().from("investor_mileage_statements").update({ status: "VOID" }).eq("id", statementId).eq("status", "DRAFT").select("id");
  if (!data?.length) return { error: "status" as const };
  await audit({ actorUserId: actor?.userId, actorType: "STAFF", action: "investor.statement_voided", entityType: "investor_mileage_statement", entityId: statementId, metadata: { by: actor?.displayName } });
  return { ok: true as const };
}

export async function disputeStatement(statementId: string, investorId: string, miles: number, note: string) {
  const statement = await getStatement(statementId);
  if (!statement || statement.investor_id !== investorId || statement.status !== "ISSUED") return { error: "status" as const };
  if (!statement.dispute_until || Date.parse(statement.dispute_until) < Date.now()) return { error: "window" as const };
  if (!Number.isInteger(miles) || miles <= 0 || miles > statement.qualifying_miles) return { error: "invalid" as const };
  const key = monthKey(statement);
  const label = `${key} · ${statement.vehicle?.fleet_number ?? ""}`.trim();
  const disputedCents = miles * statement.rate_cents;
  let entryId = statement.entry_id;
  let disputedEntryId: string | null = null;
  const entry = statement.entry_id ? await entryBrief(statement.entry_id) : null;
  if (entry && entry.bucket === "PENDING" && disputedCents > 0) {
    const frozen = Math.min(disputedCents, entry.amount_cents);
    const undisputed = entry.amount_cents - frozen;
    const entries: EntryInput[] = [
      { type: "REVERSAL", bucket: "PENDING", amountCents: -entry.amount_cents, settlesAt: entry.settles_at, reversalOf: entry.id, vehicleId: statement.vehicle_id, allocationId: statement.allocation_id, statementId, memo: `${label} · dispute`, metadata: { source: "dispute" } },
    ];
    if (undisputed > 0) entries.push({ type: "MILEAGE_FEE", bucket: "PENDING", amountCents: undisputed, settlesAt: entry.settles_at, vehicleId: statement.vehicle_id, allocationId: statement.allocation_id, statementId, memo: label, metadata: { month: key, part: "undisputed", rateCents: statement.rate_cents } });
    entries.push({ type: "MILEAGE_FEE", bucket: "PENDING", amountCents: frozen, settlesAt: null, vehicleId: statement.vehicle_id, allocationId: statement.allocation_id, statementId, memo: `${label} · disputed`, metadata: { month: key, part: "disputed", miles, rateCents: statement.rate_cents } });
    const ids = await postEntries(statement.investor_id, entries);
    entryId = undisputed > 0 ? ids[1] : null;
    disputedEntryId = ids[ids.length - 1];
  }
  await createAdminClient()
    .from("investor_mileage_statements")
    .update({ status: "DISPUTED", disputed_at: new Date().toISOString(), disputed_miles: miles, dispute_note: note, entry_id: entryId, disputed_entry_id: disputedEntryId })
    .eq("id", statementId)
    .eq("status", "ISSUED");
  await audit({ actorType: "INVESTOR", action: "investor.statement_disputed", entityType: "investor_mileage_statement", entityId: statementId, metadata: { investorId, miles, note } });
  await notifyStaffInvestorEvent("investor_statement_disputed", { name: statement.investor?.legal_name ?? "", month: key, vehicle: statement.vehicle?.fleet_number ?? "", miles: String(miles), note }, `/investors/mileage?month=${key}`, `dispute:${statementId}`);
  return { ok: true as const };
}

export async function resolveDispute(statementId: string, acceptedMiles: number, note: string, actor: Actor) {
  const statement = await getStatement(statementId);
  if (!statement || statement.status !== "DISPUTED") return { error: "status" as const };
  if (!Number.isInteger(acceptedMiles) || acceptedMiles < 0 || acceptedMiles > statement.disputed_miles) return { error: "invalid" as const };
  const key = monthKey(statement);
  const label = `${key} · ${statement.vehicle?.fleet_number ?? ""}`.trim();
  const removedMiles = statement.disputed_miles - acceptedMiles;
  const acceptedCents = acceptedMiles * statement.rate_cents;
  const supabase = createAdminClient();
  if (statement.disputed_entry_id) {
    const frozen = await entryBrief(statement.disputed_entry_id);
    if (frozen) {
      const entries: EntryInput[] = [{ type: "REVERSAL", bucket: "PENDING", amountCents: -frozen.amount_cents, settlesAt: null, reversalOf: frozen.id, vehicleId: statement.vehicle_id, allocationId: statement.allocation_id, statementId, memo: `${label} · ${note}`, metadata: { source: "dispute" }, createdBy: actor?.userId ?? null }];
      if (acceptedCents > 0) entries.push({ type: "MILEAGE_FEE", bucket: "PENDING", amountCents: acceptedCents, settlesAt: businessDaysAfter(new Date(), await payoutDaysFor(statement.investor_id)).toISOString(), vehicleId: statement.vehicle_id, allocationId: statement.allocation_id, statementId, memo: label, metadata: { month: key, part: "accepted", miles: acceptedMiles, rateCents: statement.rate_cents }, createdBy: actor?.userId ?? null });
      await postEntries(statement.investor_id, entries);
    }
  } else if (removedMiles > 0) {
    await postDelta(statement, -removedMiles * statement.rate_cents, `${label} · ${note}`, actor);
  }
  if (removedMiles > 0) await supabase.from("investor_mileage_adjustments").insert({ statement_id: statementId, miles: -removedMiles, kind: "DISPUTE", reason: note, created_by: actor?.userId ?? null });
  await supabase
    .from("investor_mileage_statements")
    .update({ status: "ISSUED", resolved_at: new Date().toISOString(), resolved_by: actor?.userId ?? null, accepted_miles: acceptedMiles, resolution_note: note, disputed_entry_id: null })
    .eq("id", statementId)
    .eq("status", "DISPUTED");
  await recalc(statementId);
  await audit({ actorUserId: actor?.userId, actorType: "STAFF", action: "investor.statement_resolved", entityType: "investor_mileage_statement", entityId: statementId, metadata: { by: actor?.displayName, acceptedMiles, removedMiles, note } });
  const fresh = await getStatement(statementId);
  await notifyInvestorEvent(statement.investor_id, "statement_resolved", { month: key, vehicle: statement.vehicle?.fleet_number ?? "", miles: String(acceptedMiles), amount: formatMoney(fresh?.amount_cents ?? 0), note }, `/earnings?month=${key}`);
  return { ok: true as const };
}

export async function createMonthlyStatements(month: string) {
  const supabase = createAdminClient();
  const result = { month, created: 0, issued: 0, drafts: 0, skipped: 0 };
  const { end } = monthBounds(month);
  const lastDay = zonedParts(new Date(end.getTime() - 1), zone).date;
  const { data: allocations } = await supabase
    .from("investor_allocations")
    .select("id, investor_id, vehicle_id, effective_from, effective_to, status, investor:investors!inner(status)")
    .eq("compensation", "PER_MILE")
    .in("investor.status", ["ACTIVE", "SUSPENDED"])
    .lte("effective_from", lastDay)
    .or(`effective_to.is.null,effective_to.gte.${monthStartDate(month)}`);
  for (const allocation of (allocations ?? []) as AllocationLike[]) {
    const statement = await buildStatement(allocation, month, { issue: true }).catch((cause) => {
      console.error("[investor:mileage]", cause instanceof Error ? cause.message : cause);
      return null;
    });
    if (!statement) result.skipped += 1;
    else {
      result.created += 1;
      if (statement.status === "ISSUED") result.issued += 1;
      else result.drafts += 1;
    }
  }
  return result;
}

export async function createExitStatement(allocation: AllocationLike, effectiveTo: string, actor: Actor) {
  const supabase = createAdminClient();
  const { data: investor } = await supabase.from("investors").select("compensation").eq("id", allocation.investor_id).maybeSingle();
  if (investor?.compensation !== "PER_MILE") return null;
  const month = effectiveTo.slice(0, 7);
  const { start: monthStart } = monthBounds(month);
  const periodStart = new Date(Math.max(monthStart.getTime(), dayStart(allocation.effective_from).getTime()));
  const now = Date.now();
  let periodEnd = new Date(Math.min(dayEnd(effectiveTo).getTime(), now));
  if (periodEnd.getTime() <= periodStart.getTime()) periodEnd = dayEnd(effectiveTo);
  const latest = await readingAt(allocation.vehicle_id, periodEnd.toISOString());
  let endReading: { reading: number; source: OdometerSource; note?: string | null } | null = null;
  if (latest && Date.parse(latest.read_at) >= periodStart.getTime()) endReading = { reading: latest.reading, source: latest.source, note: "exit" };
  else {
    const { data: vehicle } = await supabase.from("vehicles").select("odometer").eq("id", allocation.vehicle_id).maybeSingle();
    if (vehicle?.odometer !== null && vehicle?.odometer !== undefined) endReading = { reading: vehicle.odometer, source: "MANUAL", note: "exit" };
  }
  return buildStatement({ ...allocation, effective_to: effectiveTo }, month, { final: true, periodEnd, endReading, actor, issue: true }).catch((cause) => {
    console.error("[investor:mileage]", cause instanceof Error ? cause.message : cause);
    return null;
  });
}

export async function markSettledStatements() {
  const supabase = createAdminClient();
  const { data: issued } = await supabase.from("investor_mileage_statements").select("id").eq("status", "ISSUED").lte("dispute_until", new Date().toISOString());
  const ids = (issued ?? []).map((row) => row.id);
  if (!ids.length) return 0;
  const { data: pending } = await supabase.from("investor_ledger_entries").select("statement_id").in("statement_id", ids).eq("bucket", "PENDING").not("settles_at", "is", null);
  const blocked = new Set((pending ?? []).map((row) => row.statement_id));
  const done = ids.filter((id) => !blocked.has(id));
  if (!done.length) return 0;
  await supabase.from("investor_mileage_statements").update({ status: "SETTLED" }).in("id", done).eq("status", "ISSUED");
  return done.length;
}

export async function sweepMileagePayouts() {
  const supabase = createAdminClient();
  const settings = await loadInvestorSettings();
  const { data: investors } = await supabase.from("investors").select("id, legal_name").eq("compensation", "PER_MILE").eq("status", "ACTIVE");
  const result = { created: 0, noAccount: 0 };
  const nowIso = new Date().toISOString();
  const month = zonedParts(new Date(), zone).date.slice(0, 7);
  for (const investor of investors ?? []) {
    const balances = await loadBalances(investor.id);
    if (balances.availableCents <= 0 || balances.heldCents > 0) continue;
    const { data: account } = await supabase.from("investor_bank_accounts").select("id, last4").eq("investor_id", investor.id).is("removed_at", null).lte("usable_after", nowIso).order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (!account) {
      result.noAccount += 1;
      await notifyInvestorEvent(investor.id, "payout_no_account", { amount: formatMoney(balances.availableCents) }, "/account#accounts", { dedupeKey: `payout_no_account:${investor.id}:${month}` });
      continue;
    }
    const amountCents = balances.availableCents;
    const approved = amountCents <= settings.withdrawalApprovalCents;
    const { data: withdrawal, error } = await supabase
      .from("investor_withdrawals")
      .insert({ investor_id: investor.id, bank_account_id: account.id, amount_cents: amountCents, status: approved ? "APPROVED" : "REQUESTED", kind: "AUTO", reviewed_at: approved ? nowIso : null })
      .select("id")
      .single();
    if (error || !withdrawal) continue;
    try {
      await postEntries(investor.id, [{ type: "WITHHELD", bucket: "AVAILABLE", amountCents: -amountCents, withdrawalId: withdrawal.id, memo: `•••• ${account.last4}` }]);
    } catch {
      await supabase.from("investor_withdrawals").delete().eq("id", withdrawal.id);
      continue;
    }
    result.created += 1;
    await audit({ actorType: "SYSTEM", action: "investor.payout_created", entityType: "investor_withdrawal", entityId: withdrawal.id, metadata: { investorId: investor.id, amountCents, approved } });
    await notifyInvestorEvent(investor.id, "payout_scheduled", { amount: formatMoney(amountCents), last4: account.last4 }, "/funds", { dedupeKey: `payout_scheduled:${withdrawal.id}` });
    await notifyStaffInvestorEvent("investor_payout_created", { name: investor.legal_name, amount: formatMoney(amountCents), last4: account.last4 }, `/investors/${investor.id}`, `payout:${withdrawal.id}`);
  }
  return result;
}

export async function runMileageTick() {
  const today = zonedParts(new Date(), zone).date;
  const day = Number(today.slice(8, 10));
  const result: Record<string, unknown> = {};
  if (day <= 3) result.statements = await createMonthlyStatements(previousMonth(today.slice(0, 7)));
  result.settled = await markSettledStatements();
  result.payouts = await sweepMileagePayouts();
  return result;
}
