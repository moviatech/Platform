import "server-only";
import { z } from "zod";
import { ageBands, pickupMethods, pricingConfigSchema, ratePlans, type PricingConfig } from "@/features/pricing/config";
import { buildQuote, QuoteError, rentalDays, type Quote, type RateOverride } from "@/features/pricing/quote";
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
});

export type TripInput = z.infer<typeof tripSchema>;

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
  const [{ id: configId, data: config }, location] = await Promise.all([loadActiveConfig(), loadPrimaryLocation()]);

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
      addOns: input.addOns,
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

export async function countAvailable(classId: string, pickupAt: Date, returnAt: Date) {
  const { data, error } = await createAdminClient().rpc("available_vehicles", {
    p_class_id: classId,
    p_pickup_at: pickupAt.toISOString(),
    p_return_at: returnAt.toISOString(),
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
  const { priced, trip } = input;
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
  return data as CreatedReservation;
}
