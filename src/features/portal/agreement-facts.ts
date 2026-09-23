import "server-only";
import { pricingConfigSchema } from "@/features/pricing/config";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatFullDateTime } from "@/lib/utils/format";
import type { AgreementFacts, WaiverTier } from "./agreement";

type Line = { type: string; code: string; quantity: number; unit_cents: number; amount_cents: number };

type Row = {
  id: string;
  number: string;
  pickup_at: string;
  return_at: string;
  rental_days: number;
  rate_plan: string;
  pickup_method: string;
  delivery_address: string | null;
  total_cents: number;
  tax_cents: number;
  security_hold_cents: number;
  protection: string;
  add_ons: string[];
  pricing_config_id: string;
  quote_snapshot: { depositCents?: number; tier?: string; multiplierBps?: number; averageDailyCents?: number } | null;
  policy_snapshot: { mileage?: { allowance: { daily: number; weekly: number; monthly: number }; excessRateCents: Record<string, number> } } | null;
  customer: {
    full_name: string;
    email: string | null;
    phone: string | null;
    address: string | null;
    date_of_birth: string | null;
    license_state: string | null;
    license_last4: string | null;
    license_expires_on: string | null;
    stripe_card_brand: string | null;
    stripe_card_last4: string | null;
  } | null;
  vehicle_class: { name: string; name_zh: string | null; model: string } | null;
  vehicle: { year: number | null; vin: string | null; license_plate: string | null } | null;
  pickup_location: { name: string; name_zh: string | null; address: string | null; tax_rate_bps: number } | null;
  return_location: { name: string; name_zh: string | null; address: string | null } | null;
  line_items: Line[];
};

const waiverTiers: WaiverTier[] = ["none", "basic", "standard", "premier"];

export async function loadAgreementFacts(reservationId: string, locale: string): Promise<AgreementFacts | null> {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("reservations")
    .select(
      "id, number, pickup_at, return_at, rental_days, rate_plan, pickup_method, delivery_address, total_cents, tax_cents, security_hold_cents, protection, add_ons, pricing_config_id, quote_snapshot, policy_snapshot, customer:customers(full_name, email, phone, address, date_of_birth, license_state, license_last4, license_expires_on, stripe_card_brand, stripe_card_last4), vehicle_class:vehicle_classes(name, name_zh, model), vehicle:vehicles!reservations_assigned_vehicle_id_fkey(year, vin, license_plate), pickup_location:locations!reservations_pickup_location_id_fkey(name, name_zh, address, tax_rate_bps), return_location:locations!reservations_return_location_id_fkey(name, name_zh, address), line_items:reservation_line_items(type, code, quantity, unit_cents, amount_cents)",
    )
    .eq("id", reservationId)
    .maybeSingle();
  const row = data as unknown as Row | null;
  if (!row) return null;

  const [{ data: config }, { data: settings }, { data: payments }] = await Promise.all([
    supabase.from("pricing_configs").select("data").eq("id", row.pricing_config_id).single(),
    supabase.from("settings").select("key, value").in("key", ["business", "insurance"]),
    supabase.from("payments").select("kind, status, amount_captured_cents, amount_refunded_cents").eq("reservation_id", row.id).in("kind", ["RENTAL", "ADDITIONAL"]),
  ]);
  const rules = pricingConfigSchema.parse(config?.data ?? {});
  const stringMap = (value: unknown) => Object.fromEntries(Object.entries((value ?? {}) as Record<string, unknown>).map(([k, v]) => [k, typeof v === "string" ? v : ""]));
  const business = stringMap(settings?.find((s) => s.key === "business")?.value);
  const insurance = stringMap(settings?.find((s) => s.key === "insurance")?.value);
  const paidCents = (payments ?? []).reduce((sum, p) => sum + (p.amount_captured_cents - p.amount_refunded_cents), 0);

  const zh = locale === "zh";
  const model = row.vehicle_class?.model ?? "model-y";
  const line = (predicate: (l: Line) => boolean) => row.line_items.find(predicate) ?? null;
  const rental = line((l) => l.type === "RENTAL");
  const protection = line((l) => l.type === "PROTECTION");
  const charging = line((l) => l.code === "addon.charging");
  const driver = line((l) => l.code === "addon.driver");
  const unlimited = line((l) => l.code === "addon.unlimitedMiles");
  const childSeat = line((l) => l.code === "addon.childSeat");
  const young = line((l) => l.type === "YOUNG_DRIVER");
  const delivery = line((l) => l.type === "DELIVERY");
  const discount = line((l) => l.type === "DISCOUNT");
  const tax = line((l) => l.type === "TAX");
  const plan = (id: string) => rules.protectionPlans.find((p) => p.id === id);
  const waiverTier: WaiverTier = waiverTiers.includes(row.protection as WaiverTier) ? (row.protection as WaiverTier) : "none";
  const allowance = row.policy_snapshot?.mileage?.allowance ?? rules.mileage.allowance;
  const dailyAllowance = allowance.daily;
  const name = (item: { name: string; name_zh: string | null } | null) => (zh ? (item?.name_zh ?? item?.name) : item?.name) ?? "";
  const depositCents = row.quote_snapshot?.depositCents ?? 0;
  const chargingAddOn = rules.addOns.find((a) => a.id === "charging");
  const extras: string[] = [];
  if (childSeat) extras.push(zh ? "儿童安全座椅（押金 $100）" : "Child safety seat (deposit $100)");

  return {
    number: row.number,
    business: {
      legalName: business.legalName || "Movia Technologies, Inc.",
      tradeName: business.tradeName || "Movia Technologies",
      address: business.address || "",
      phone: business.phone || "",
      email: business.email || "",
      emergencyPhone: business.emergencyPhone || "",
      serviceHours: business.serviceHours || "",
    },
    insurance,
    renter: {
      name: row.customer?.full_name ?? "",
      dob: row.customer?.date_of_birth ?? null,
      address: row.customer?.address ?? null,
      phone: row.customer?.phone ?? null,
      email: row.customer?.email ?? null,
      licenseState: row.customer?.license_state ?? null,
      licenseLast4: row.customer?.license_last4 ?? null,
      licenseExpires: row.customer?.license_expires_on ?? null,
    },
    vehicle: {
      className: name(row.vehicle_class),
      model,
      year: row.vehicle?.year ?? null,
      vin: row.vehicle?.vin ?? null,
      plate: row.vehicle?.license_plate ?? null,
    },
    pickup: { location: name(row.pickup_location), address: row.pickup_location?.address ?? "", at: formatFullDateTime(row.pickup_at, locale) },
    dropoff: { location: name(row.return_location), address: row.return_location?.address ?? "", at: formatFullDateTime(row.return_at, locale) },
    rentalDays: row.rental_days,
    ratePlan: row.rate_plan,
    tier: row.quote_snapshot?.tier ?? "daily",
    multiplierBps: row.quote_snapshot?.multiplierBps ?? 10000,
    averageDailyCents: rental?.unit_cents ?? row.quote_snapshot?.averageDailyCents ?? 0,
    rentalCents: rental?.amount_cents ?? 0,
    payNowDiscountCents: discount ? Math.abs(discount.amount_cents) : 0,
    youngDriver: young ? { dailyCents: young.unit_cents, totalCents: young.amount_cents } : null,
    delivery: delivery && delivery.amount_cents > 0 ? { feeCents: delivery.amount_cents, address: row.pickup_method === "DELIVERY" ? row.delivery_address : null } : null,
    mileage: {
      daily: dailyAllowance,
      total: dailyAllowance * row.rental_days,
      unlimited: Boolean(unlimited),
      excessCents: row.policy_snapshot?.mileage?.excessRateCents?.[model] ?? rules.mileage.excessRateCents[model] ?? 99,
      unlimitedCents: unlimited?.amount_cents ?? 0,
    },
    soc: { target: rules.charge.minReturnLevel, lowChargeFeeCents: rules.charge.lowChargeFeeCentsPerPercent },
    charging: charging
      ? { elected: true, dailyCents: charging.unit_cents, days: charging.quantity, totalCents: charging.amount_cents }
      : { elected: false, dailyCents: chargingAddOn && chargingAddOn.kind === "perDay" ? chargingAddOn.priceCents : 0, days: 0, totalCents: 0 },
    extraDriver: driver ? { dailyCents: driver.unit_cents, totalCents: driver.amount_cents } : null,
    waiver: {
      tier: waiverTier,
      dailyCents: protection?.unit_cents ?? plan(waiverTier)?.dailyCents ?? 0,
      totalCents: protection?.amount_cents ?? 0,
      prices: { none: 0, basic: plan("basic")?.dailyCents ?? 0, standard: plan("standard")?.dailyCents ?? 0, premier: plan("premier")?.dailyCents ?? 0 },
    },
    taxCents: tax?.amount_cents ?? row.tax_cents,
    taxRateBps: row.pickup_location?.tax_rate_bps ?? 0,
    totalCents: row.total_cents,
    paidCents,
    card: row.customer?.stripe_card_brand && row.customer.stripe_card_last4 ? { brand: row.customer.stripe_card_brand, last4: row.customer.stripe_card_last4 } : null,
    holdCents: row.security_hold_cents + depositCents,
    depositCents,
    extras,
  };
}
