import "server-only";
import { z } from "zod";
import { ageBands, pickupMethods, pricingConfigSchema, ratePlans, type PricingConfig } from "@/features/pricing/config";
import { buildQuote, QuoteError, rentalDays, type Quote, type RateOverride } from "@/features/pricing/quote";
import { syncDriverSlots } from "@/features/drivers/service";
import { insuranceRequired, licenseKinds } from "@/features/drivers/types";
import { createAdminClient } from "@/lib/supabase/admin";
import { bookingSlots, isClockTime, isIsoDate, zonedToUtc } from "./time";

export class BookingError extends Error {
  constructor(public code: string) {
    super(code);
  }
}

export const tripSchema = z.object({
  classSlug: z.string().min(1).max(60),
  pickupDate: z.string().refine(isIsoDate),
  pickupTime: z.string().refine(isClockTime),
  returnDate: z.string().refine(isIsoDate),
  returnTime: z.string().refine(isClockTime),
  protection: z.string().max(20).default("none"),
  addOns: z.array(z.string().max(30)).max(10).default([]),
  ratePlan: z.enum(ratePlans),
  ageBand: z.enum(ageBands).default("25_PLUS"),
  pickupMethod: z.enum(pickupMethods).default("STORE"),
  locationId: z.uuid().optional(),
  extraDrivers: z.coerce.number().int().min(0).max(3).default(0),
  licenseKind: z.enum(licenseKinds).optional(),
});

export type TripInput = z.infer<typeof tripSchema>;

export const driverCount = (trip: Pick<TripInput, "addOns" | "extraDrivers">) => (trip.addOns.includes("driver") || trip.extraDrivers > 0 ? Math.max(1, trip.extraDrivers) : 0);

export function normalizeTrip<T extends Pick<TripInput, "addOns" | "extraDrivers">>(trip: T): T {
  const count = driverCount(trip);
  const addOns = count > 0 ? (trip.addOns.includes("driver") ? trip.addOns : [...trip.addOns, "driver"]) : trip.addOns.filter((item) => item !== "driver");
  return { ...trip, extraDrivers: count, addOns };
}

export type VehicleClass = {
  id: string;
  slug: string;
  name: string;
  name_zh: string | null;
  model: string;
  active: boolean;
  base_daily_rate_cents: number;
  security_hold_cents: number;
  buffer_hours: number;
  seats: number | null;
  range_miles: number | null;
  sort_order: number;
};

export type Location = { id: string; code: string; name: string; name_zh: string | null; timezone: string; tax_rate_bps: number };

export async function loadActiveConfig(): Promise<{ id: string; version: number; data: PricingConfig }> {
  const { data, error } = await createAdminClient()
    .from("pricing_configs")
    .select("id, version, data")
    .lte("effective_from", new Date().toISOString())
    .order("effective_from", { ascending: false })
    .order("version", { ascending: false })
    .limit(1)
    .single();
  if (error || !data) throw new BookingError("pricing_config_missing");
  return { id: data.id, version: data.version, data: pricingConfigSchema.parse(data.data) };
}

export async function loadPrimaryLocation(): Promise<Location> {
  const { data, error } = await createAdminClient()
    .from("locations")
    .select("id, code, name, name_zh, timezone, tax_rate_bps")
    .eq("active", true)
    .order("created_at")
    .limit(1)
    .single();
  if (error || !data) throw new BookingError("location_missing");
  return data as Location;
}

export async function loadLocation(id: string): Promise<Location> {
      const { data, error } = await createAdminClient().from("locations").select("id, code, name, name_zh, timezone, tax_rate_bps").eq("id", id).eq("active", true).maybeSingle();
      if (error || !data) throw new BookingError("location_missing");
      return data as Location;
    }

    export async function loadVehicleLocation(vehicleId: string): Promise<Location> {
      const { data } = await createAdminClient().from("vehicles").select("location:locations(id, code, name, name_zh, timezone, tax_rate_bps)").eq("id", vehicleId).maybeSingle();
      const location = (data as { location: Location | null } | null)?.location;
      if (!location) throw new BookingError("location_missing");
      return location;
    }

    export async function listClasses(activeOnly = true): Promise<VehicleClass[]> {
  let query = createAdminClient().from("vehicle_classes").select("*").order("sort_order");
  if (activeOnly) query = query.eq("active", true);
  const { data, error } = await query;
  if (error) throw new BookingError("classes_unavailable");
  return (data ?? []) as VehicleClass[];
}

export type PricedTrip = {
  vehicleClass: VehicleClass;
  location: Location;
  configId: string;
  config: PricingConfig;
  pickupAt: Date;
  returnAt: Date;
  quote: Quote;
};

export async function priceTrip(input: TripInput, options: { enforceLeadTime: boolean }): Promise<PricedTrip> {
  const supabase = createAdminClient();
  const [{ id: configId, data: config }, location] = await Promise.all([loadActiveConfig(), input.locationId ? loadLocation(input.locationId) : loadPrimaryLocation()]);

  const { data: vehicleClass } = await supabase.from("vehicle_classes").select("*").eq("slug", input.classSlug).eq("active", true).maybeSingle();
  if (!vehicleClass) throw new BookingError("class_not_found");

  const days = rentalDays(input.pickupDate, input.pickupTime, input.returnDate, input.returnTime);
  if (days < 1) throw new BookingError("invalid_period");
  if (days > config.maxRentalDays) throw new BookingError("too_long");

  const pickupAt = zonedToUtc(input.pickupDate, input.pickupTime, location.timezone);
  const returnAt = zonedToUtc(input.returnDate, input.returnTime, location.timezone);

  if (options.enforceLeadTime) {
    const slots = bookingSlots(config.bookingWindow);
    if (!slots.includes(input.pickupTime) || !slots.includes(input.returnTime)) throw new BookingError("outside_hours");
    if (pickupAt.getTime() < Date.now() + config.minLeadHours * 3600000) throw new BookingError("too_soon");
  }

  const { data: overrideRows } = await supabase
    .from("rate_overrides")
    .select("date_from, date_to, daily_rate_cents")
    .eq("class_id", vehicleClass.id)
    .lte("date_from", input.returnDate)
    .gte("date_to", input.pickupDate)
    .order("created_at", { ascending: false });
  const overrides: RateOverride[] = (overrideRows ?? []).map((row) => ({ dateFrom: row.date_from, dateTo: row.date_to, dailyRateCents: row.daily_rate_cents }));

  try {
    const quote = buildQuote({
      config,
      baseDailyRateCents: vehicleClass.base_daily_rate_cents,
      securityHoldCents: vehicleClass.security_hold_cents,
      taxRateBps: location.tax_rate_bps,
      pickupDate: input.pickupDate,
      days,
      protection: input.protection,
      addOns: normalizeTrip(input).addOns,
      extraDrivers: driverCount(input),
      ratePlan: input.ratePlan,
      ageBand: input.ageBand,
      pickupMethod: input.pickupMethod,
      overrides,
    });
    return { vehicleClass: vehicleClass as VehicleClass, location, configId, config, pickupAt, returnAt, quote };
  } catch (cause) {
    if (cause instanceof QuoteError) throw new BookingError(cause.message);
    throw cause;
  }
}

export async function countAvailable(classId: string, pickupAt: Date, returnAt: Date, locationId: string) {
  const { data, error } = await createAdminClient().rpc("available_vehicles", {
    p_class_id: classId,
    p_pickup_at: pickupAt.toISOString(),
    p_return_at: returnAt.toISOString(),
    p_location_id: locationId,
  });
  if (error) throw new BookingError("availability_unavailable");
  return ((data as Array<{ id: string; fleet_number: string }> | null) ?? []).map((row) => ({ id: row.id, fleetNumber: row.fleet_number }));
}

export type CustomerInput = { fullName: string; email?: string | null; phone?: string | null; wechat?: string | null; language?: string | null };

export type CreateReservationInput = {
  priced: PricedTrip;
  trip: TripInput;
  customer: CustomerInput;
  customerId?: string | null;
  vehicleId?: string | null;
  status: "REQUESTED" | "PENDING_PAYMENT" | "CONFIRMED";
  source: "WEB" | "STAFF" | "PHONE" | "WECHAT";
  expiresAt?: Date | null;
  deliveryAddress?: string | null;
  customerNotes?: string | null;
  internalNotes?: string | null;
  leadId?: string | null;
  createdBy?: string | null;
};

export type CreatedReservation = { id: string; number: string; vehicle_id: string; customer_id: string };

const knownErrors = ["no_vehicle_available", "class_not_found", "invalid_period", "customer_blocked"];

export async function createReservation(input: CreateReservationInput): Promise<CreatedReservation> {
  const { priced } = input;
  const trip = normalizeTrip(input.trip);
  if (trip.licenseKind && trip.licenseKind !== "US" && trip.pickupMethod === "SELF_SERVICE") throw new BookingError("license_self_service");
  const { data, error } = await createAdminClient().rpc("create_reservation", {
    payload: {
      class_id: priced.vehicleClass.id,
      location_id: priced.location.id,
      vehicle_id: input.vehicleId ?? null,
      customer_id: input.customerId ?? null,
      customer: {
        full_name: input.customer.fullName,
        email: input.customer.email ?? null,
        phone: input.customer.phone ?? null,
        wechat: input.customer.wechat ?? null,
        preferred_language: input.customer.language ?? "en",
      },
      pickup_at: priced.pickupAt.toISOString(),
      return_at: priced.returnAt.toISOString(),
      status: input.status,
      rate_plan: trip.ratePlan,
      pickup_method: trip.pickupMethod,
      delivery_address: input.deliveryAddress ?? null,
      protection: trip.protection,
      add_ons: trip.addOns,
      driver_age_band: trip.ageBand,
      pricing_config_id: priced.configId,
      quote: priced.quote,
      policy: { cancelPolicy: priced.config.cancelPolicy, mileage: priced.config.mileage, returnGraceMinutes: priced.config.returnGraceMinutes },
      booking_source: input.source,
      lead_id: input.leadId ?? null,
      expires_at: input.expiresAt?.toISOString() ?? null,
      customer_notes: input.customerNotes ?? null,
      internal_notes: input.internalNotes ?? null,
      created_by: input.createdBy ?? null,
    },
  });
  if (error) {
    const code = knownErrors.find((item) => error.message.includes(item));
    throw new BookingError(code ?? "reservation_failed");
  }
  const created = data as CreatedReservation;
  const drivers = driverCount(trip);
  if (drivers > 0) await syncDriverSlots(created.id, drivers);
  if (insuranceRequired(trip.protection)) await createAdminClient().from("reservations").update({ insurance_state: "PENDING" }).eq("id", created.id);
  if (trip.licenseKind) await createAdminClient().from("customers").update({ license_kind: trip.licenseKind }).eq("id", created.customer_id);
  return created;
}
