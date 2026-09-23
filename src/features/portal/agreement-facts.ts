import "server-only";
import { loadActiveConfig, loadPrimaryLocation } from "@/features/booking/service";
import { pricingConfigSchema, type PricingConfig } from "@/features/pricing/config";
import { excessRateFor, waiverDailyCents } from "@/features/pricing/quote";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatFullDateTime } from "@/lib/utils/format";
import type { AgreementFacts, WaiverTier } from "./agreement";

type Line = { type: string; code: string; quantity: number; unit_cents: number; amount_cents: number };

type Row = {
  id: string;
  number: string;
  updated_at: string;
  status: string;
  created_at: string;
  insurance_state: string;
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
  spouse_driver: boolean;
  special_terms: string | null;
  special_terms_zh: string | null;
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
    license_kind: string | null;
    stripe_card_brand: string | null;
    stripe_card_last4: string | null;
  } | null;
  vehicle_class: { name: string; name_zh: string | null; model: string } | null;
  vehicle: { year: number | null; vin: string | null; license_plate: string | null } | null;
  tax_rate_bps: number | null;
  pickup_location: { name: string; name_zh: string | null; address: string | null } | null;
  return_location: { name: string; name_zh: string | null; address: string | null } | null;
  line_items: Line[];
};

const waiverTiers: WaiverTier[] = ["none", "basic", "standard", "premier"];

const oneLine = (value: string | null | undefined) => (value ?? "").replace(/\s+/g, " ").trim() || null;

const stringMap = (value: unknown) => Object.fromEntries(Object.entries((value ?? {}) as Record<string, unknown>).map(([k, v]) => [k, typeof v === "string" ? v : ""]));

async function loadBusinessSettings() {
  const { data } = await createAdminClient().from("settings").select("key, value").in("key", ["business", "insurance"]);
  const business = stringMap(data?.find((s) => s.key === "business")?.value);
  return {
    business: {
      legalName: business.legalName || "Movia Technologies, Inc.",
      tradeName: business.tradeName || "Movia Technologies",
      address: business.address || "",
      phone: business.phone || "",
      email: business.email || "",
      emergencyPhone: business.emergencyPhone || "",
      serviceHours: business.serviceHours || "",
    },
    insurance: stringMap(data?.find((s) => s.key === "insurance")?.value),
  };
}

const paidTiers = ["basic", "standard", "premier"] as const;

function publishedTerms(rules: PricingConfig, mileageDaily: number, excessRates: Record<string, number>): AgreementFacts["published"] {
  return {
    mileageDaily,
    excessStandardCents: excessRates["model-y"] ?? excessRates["model-3"] ?? 0,
    excessTruckCents: excessRates.cybertruck ?? 0,
    waiverCents: paidTiers.map((tier) => waiverDailyCents(rules, tier, "model-y")),
    waiverTruckCents: paidTiers.map((tier) => waiverDailyCents(rules, tier, "cybertruck")),
  };
}

const perDayPriceCents = (rules: ReturnType<typeof pricingConfigSchema.parse>, id: string) => {
  const item = rules.addOns.find((a) => a.id === id);
  return item && item.kind === "perDay" ? item.priceCents : 0;
};

export async function loadTemplateFacts(): Promise<AgreementFacts> {
  const [{ business, insurance }, { data: rules }, location] = await Promise.all([loadBusinessSettings(), loadActiveConfig(), loadPrimaryLocation().catch(() => null)]);
  const plan = (id: string) => rules.protectionPlans.find((p) => p.id === id);
  const chargingAddOn = rules.addOns.find((a) => a.id === "charging");
  return {
    number: "",
    business,
    insurance,
    renter: { name: "", dob: null, address: null, phone: null, email: null, licenseState: null, licenseLast4: null, licenseExpires: null },
    vehicle: { className: "", model: "", year: null, vin: null, plate: null },
    pickup: { location: "", address: "", at: "" },
    dropoff: { location: "", address: "", at: "" },
    rentalDays: 0,
    ratePlan: "daily",
    tier: "daily",
    multiplierBps: 10000,
    averageDailyCents: 0,
    rentalCents: 0,
    payNowDiscountCents: 0,
    otherDiscountCents: 0,
    youngDriver: null,
    delivery: null,
    handover: { method: "STORE", address: null },
    mileage: { daily: rules.mileage.allowance.daily, total: 0, unlimited: false, excessCents: 0, unlimitedCents: 0 },
    published: publishedTerms(rules, rules.mileage.allowance.daily, rules.mileage.excessRateCents),
    soc: { target: rules.charge.minReturnLevel, lowChargeFeeCents: rules.charge.lowChargeFeeCentsPerPercent },
    charging: { elected: false, dailyCents: chargingAddOn && chargingAddOn.kind === "perDay" ? chargingAddOn.priceCents : 0, days: 0, totalCents: 0 },
    extraDriver: null,
    waiver: {
      tier: "none",
      dailyCents: 0,
      totalCents: 0,
      prices: { none: 0, basic: plan("basic")?.dailyCents ?? 0, standard: plan("standard")?.dailyCents ?? 0, premier: plan("premier")?.dailyCents ?? 0 },
      deductibles: { none: 0, basic: plan("basic")?.deductibleCents ?? 0, standard: plan("standard")?.deductibleCents ?? 0, premier: plan("premier")?.deductibleCents ?? 0 },
    },
    taxCents: 0,
    taxRateBps: location?.tax_rate_bps ?? 0,
    totalCents: 0,
    paidCents: 0,
    card: null,
    holdCents: 0,
    depositCents: 0,
    extras: [],
    specialTerms: null,
    licenseKind: null,
    status: "CONFIRMED",
    confirmedAt: null,
    insuranceState: "NOT_REQUIRED",
    seenAt: "",
  };
}

export async function loadAgreementFacts(reservationId: string, locale: string): Promise<AgreementFacts | null> {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("reservations")
    .select(
      "id, number, updated_at, status, created_at, insurance_state, pickup_at, return_at, rental_days, rate_plan, pickup_method, delivery_address, total_cents, tax_cents, tax_rate_bps, security_hold_cents, protection, add_ons, spouse_driver, special_terms, special_terms_zh, pricing_config_id, quote_snapshot, policy_snapshot, customer:customers(full_name, email, phone, address, date_of_birth, license_state, license_last4, license_expires_on, license_kind, stripe_card_brand, stripe_card_last4), vehicle_class:vehicle_classes(name, name_zh, model), vehicle:vehicles!reservations_assigned_vehicle_id_fkey(year, vin, license_plate), pickup_location:locations!reservations_pickup_location_id_fkey(name, name_zh, address), return_location:locations!reservations_return_location_id_fkey(name, name_zh, address), line_items:reservation_line_items(type, code, quantity, unit_cents, amount_cents)",
    )
    .eq("id", reservationId)
    .maybeSingle();
  const row = data as unknown as Row | null;
  if (!row) return null;

  const [{ data: config }, { business, insurance }, { data: payments }] = await Promise.all([
    supabase.from("pricing_configs").select("data").eq("id", row.pricing_config_id).single(),
    loadBusinessSettings(),
    supabase.from("payments").select("kind, status, amount_captured_cents, amount_refunded_cents").eq("reservation_id", row.id).eq("kind", "RENTAL"),
  ]);
  const rules = pricingConfigSchema.parse(config?.data ?? {});
  const paidCents = (payments ?? []).reduce((sum, p) => sum + (p.amount_captured_cents - p.amount_refunded_cents), 0);
  const { data: driverRows } = await supabase.from("reservation_drivers").select("full_name").eq("reservation_id", row.id).order("position");
  const { data: confirmations } = await supabase.from("audit_events").select("created_at").eq("entity_id", row.id).eq("action", "reservation.status_changed").eq("metadata->>to", "CONFIRMED").order("created_at", { ascending: false }).limit(1);
  const confirmedAt = (confirmations?.[0]?.created_at as string | undefined) ?? (["CONFIRMED", "ACTIVE", "COMPLETED"].includes(row.status) ? row.created_at : null);
  const driverNames = (driverRows ?? []).map((item) => oneLine(item.full_name)).filter((name): name is string => Boolean(name));

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
  const discountOf = (predicate: (l: Line) => boolean) => -row.line_items.filter((l) => l.type === "DISCOUNT" && predicate(l)).reduce((sum, l) => sum + l.amount_cents, 0);
  const tax = line((l) => l.type === "TAX");
  const plan = (id: string) => rules.protectionPlans.find((p) => p.id === id);
  const waiverTier: WaiverTier = waiverTiers.includes(row.protection as WaiverTier) ? (row.protection as WaiverTier) : "none";
  const allowance = row.policy_snapshot?.mileage?.allowance ?? rules.mileage.allowance;
  const dailyAllowance = allowance.daily;
  const excessRates = row.policy_snapshot?.mileage?.excessRateCents;
  const name = (item: { name: string; name_zh: string | null } | null) => (zh ? (item?.name_zh ?? item?.name) : item?.name) ?? "";
  const depositCents = row.quote_snapshot?.depositCents ?? 0;
  const chargingAddOn = rules.addOns.find((a) => a.id === "charging");
  const extras: string[] = [];
  if (childSeat) extras.push(zh ? "儿童安全座椅（押金 $100）" : "Child safety seat (deposit $100)");

  return {
    number: row.number,
    business,
    insurance,
    renter: {
      name: oneLine(row.customer?.full_name) ?? "",
      dob: row.customer?.date_of_birth ?? null,
      address: oneLine(row.customer?.address),
      phone: oneLine(row.customer?.phone),
      email: oneLine(row.customer?.email),
      licenseState: oneLine(row.customer?.license_state),
      licenseLast4: oneLine(row.customer?.license_last4),
      licenseExpires: row.customer?.license_expires_on ?? null,
    },
    vehicle: {
      className: name(row.vehicle_class),
      model,
      year: row.vehicle?.year ?? null,
      vin: row.vehicle?.vin ?? null,
      plate: row.vehicle?.license_plate ?? null,
    },
    pickup: { location: name(row.pickup_location), address: row.pickup_location?.address ?? "", at: formatFullDateTime(row.pickup_at) },
    dropoff: { location: name(row.return_location), address: row.return_location?.address ?? "", at: formatFullDateTime(row.return_at) },
    rentalDays: row.rental_days,
    ratePlan: row.rate_plan,
    tier: row.quote_snapshot?.tier ?? "daily",
    multiplierBps: row.quote_snapshot?.multiplierBps ?? 10000,
    averageDailyCents: rental?.unit_cents ?? row.quote_snapshot?.averageDailyCents ?? 0,
    rentalCents: rental?.amount_cents ?? 0,
    payNowDiscountCents: discountOf((l) => l.code === "discount.pay_now"),
    otherDiscountCents: discountOf((l) => l.code !== "discount.pay_now"),
    youngDriver: young ? { dailyCents: young.unit_cents, totalCents: young.amount_cents } : null,
    delivery: delivery && delivery.amount_cents > 0 ? { feeCents: delivery.amount_cents } : null,
    handover: { method: row.pickup_method, address: row.pickup_method === "STORE" ? null : oneLine(row.delivery_address) },
    mileage: {
      daily: dailyAllowance,
      total: dailyAllowance * row.rental_days,
      unlimited: Boolean(unlimited),
      excessCents: excessRateFor(excessRates, rules.mileage.excessRateCents, model),
      unlimitedCents: unlimited?.amount_cents ?? 0,
    },
    published: publishedTerms(rules, dailyAllowance, { ...rules.mileage.excessRateCents, ...excessRates }),
    soc: { target: rules.charge.minReturnLevel, lowChargeFeeCents: rules.charge.lowChargeFeeCentsPerPercent },
    charging: charging
      ? { elected: true, dailyCents: charging.unit_cents, days: charging.quantity, totalCents: charging.amount_cents }
      : { elected: false, dailyCents: chargingAddOn && chargingAddOn.kind === "perDay" ? chargingAddOn.priceCents : 0, days: 0, totalCents: 0 },
    extraDriver: driver ? { dailyCents: driver.unit_cents || perDayPriceCents(rules, "driver"), totalCents: driver.amount_cents, names: driverNames, count: Math.max(1, (driverRows ?? []).length), spouse: Boolean(row.spouse_driver) } : null,
    waiver: {
      tier: waiverTier,
      dailyCents: protection?.unit_cents ?? waiverDailyCents(rules, waiverTier, model),
      totalCents: protection?.amount_cents ?? 0,
      prices: { none: 0, basic: waiverDailyCents(rules, "basic", model), standard: waiverDailyCents(rules, "standard", model), premier: waiverDailyCents(rules, "premier", model) },
      deductibles: { none: 0, basic: plan("basic")?.deductibleCents ?? 0, standard: plan("standard")?.deductibleCents ?? 0, premier: plan("premier")?.deductibleCents ?? 0 },
    },
    taxCents: tax?.amount_cents ?? row.tax_cents,
    taxRateBps: Number(row.tax_rate_bps ?? 0),
    totalCents: row.total_cents,
    paidCents,
    card: row.customer?.stripe_card_brand && row.customer.stripe_card_last4 ? { brand: row.customer.stripe_card_brand, last4: row.customer.stripe_card_last4 } : null,
    holdCents: row.security_hold_cents + depositCents,
    depositCents,
    extras,
    specialTerms: (zh ? row.special_terms_zh || row.special_terms : row.special_terms || row.special_terms_zh)?.trim() || null,
    licenseKind: row.customer?.license_kind ?? null,
    status: row.status,
    confirmedAt: confirmedAt ? formatFullDateTime(confirmedAt) : null,
    insuranceState: row.insurance_state,
    seenAt: row.updated_at,
  };
}

export type SignedRecord = { templateVersion: string; locale: string; text: string; hash: string; signerName: string; signerIp: string | null; userAgent: string | null; signedAt: string; elections: unknown; signatureImage: string };

export async function recordSignature(reservationId: string, seenAt: string, record: SignedRecord): Promise<{ outcome: "signed" | "already" | "changed" | "failed"; version?: number }> {
  const { data, error } = await createAdminClient().rpc("sign_reservation_agreement", {
    p_reservation_id: reservationId,
    p_seen_at: seenAt,
    p_agreement: {
      template_version: record.templateVersion,
      locale: record.locale,
      terms_snapshot: record.text,
      terms_hash: record.hash,
      signer_name: record.signerName,
      signer_ip: record.signerIp,
      user_agent: record.userAgent,
      signed_at: record.signedAt,
      elections: record.elections,
      signature_image: record.signatureImage,
    },
  });
  const result = data as { outcome?: string; version?: number } | null;
  if (error || !result) return { outcome: "failed" };
  return result.outcome === "signed" || result.outcome === "already" ? { outcome: result.outcome, version: result.version } : { outcome: "changed" };
}

export async function supersedeAgreements(reservationId: string) {
  await createAdminClient().from("agreements").update({ superseded_at: new Date().toISOString() }).eq("reservation_id", reservationId).is("superseded_at", null);
}
