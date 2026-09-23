import "server-only";
import { pricingConfigSchema } from "@/features/pricing/config";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { photoBucket, type InspectionKind, type ReturnParams } from "./types";

export type InspectionRecord = {
  id: string;
  kind: InspectionKind;
  odometer: number;
  battery_level: number;
  accessories: Record<string, boolean>;
  checklist: Record<string, unknown>;
  charges: Array<{ code: string; quantity?: number; unitCents?: number; amountCents: number; pendingConsent?: boolean }>;
  damage_notes: string | null;
  renter_remarks: string | null;
  performed_at: string;
  performed_by: { display_name: string } | null;
  photos: Array<{ id: string; url: string }>;
};

type Row = Omit<InspectionRecord, "photos"> & { photos: Array<{ id: string; storage_path: string }> };

export async function listInspections(reservationId: string): Promise<InspectionRecord[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("inspections")
    .select("id, kind, odometer, battery_level, accessories, checklist, charges, damage_notes, renter_remarks, performed_at, performed_by:staff_members(display_name), photos:inspection_photos(id, storage_path)")
    .eq("reservation_id", reservationId)
    .order("performed_at");
  const rows = (data ?? []) as unknown as Row[];
  const paths = rows.flatMap((row) => row.photos.map((photo) => photo.storage_path));
  const urls = new Map<string, string>();
  if (paths.length) {
    const { data: signed } = await createAdminClient().storage.from(photoBucket).createSignedUrls(paths, 600);
    for (const item of signed ?? []) if (item.path && item.signedUrl) urls.set(item.path, item.signedUrl);
  }
  return rows.map((row) => ({ ...row, photos: row.photos.map((photo) => ({ id: photo.id, url: urls.get(photo.storage_path) ?? "" })).filter((photo) => photo.url) }));
}

type ParamRow = {
  start_odometer: number | null;
  return_at: string;
  rental_days: number;
  add_ons: string[];
  pricing_config_id: string;
  quote_snapshot: { averageDailyCents?: number } | null;
  policy_snapshot: { mileage?: { allowance: { daily: number }; excessRateCents: Record<string, number> }; returnGraceMinutes?: number } | null;
  vehicle_class: { model: string } | null;
  vehicle: { odometer: number | null } | null;
  location: { tax_rate_bps: number | null } | null;
};

export async function loadReturnParams(reservationId: string): Promise<ReturnParams | null> {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("reservations")
    .select("start_odometer, return_at, rental_days, add_ons, pricing_config_id, quote_snapshot, policy_snapshot, vehicle_class:vehicle_classes(model), vehicle:vehicles!reservations_assigned_vehicle_id_fkey(odometer), location:locations!reservations_pickup_location_id_fkey(tax_rate_bps)")
    .eq("id", reservationId)
    .maybeSingle();
  const row = data as unknown as ParamRow | null;
  if (!row) return null;
  const { data: config } = await supabase.from("pricing_configs").select("data").eq("id", row.pricing_config_id).single();
  const rules = pricingConfigSchema.parse(config?.data ?? {});
  const model = row.vehicle_class?.model ?? "model-y";
  const daily = row.policy_snapshot?.mileage?.allowance.daily ?? rules.mileage.allowance.daily;
  return {
    startOdometer: row.start_odometer ?? row.vehicle?.odometer ?? 0,
    allowanceMiles: row.add_ons.includes("unlimitedMiles") ? null : daily * row.rental_days,
    excessRateCents: row.policy_snapshot?.mileage?.excessRateCents?.[model] ?? rules.mileage.excessRateCents[model] ?? 0,
    minReturnLevel: rules.charge.minReturnLevel,
    lowChargeFeeCentsPerPercent: rules.charge.lowChargeFeeCentsPerPercent,
    scheduledReturnAt: row.return_at,
    graceMinutes: row.policy_snapshot?.returnGraceMinutes ?? rules.returnGraceMinutes,
    dailyRateCents: row.quote_snapshot?.averageDailyCents ?? 0,
    lateFeeCents: { notified: rules.lateReturn.notifiedFeeCents, unannounced: rules.lateReturn.unannouncedFeeCents },
    returnFeesTaxable: rules.tax.returnFees,
    taxRateBps: row.location?.tax_rate_bps ?? 0,
  };
}
