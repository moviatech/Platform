import { createHash } from "node:crypto";
import { z } from "zod";
import { formatFullDateTime, formatMoney } from "@/lib/utils/format";
import { en } from "./agreement-text/en";
import { zh } from "./agreement-text/zh";
import type { AgreementText } from "./agreement-text/types";

export const agreementVersion = "2026-09-25.1";

export type WaiverTier = "none" | "basic" | "standard" | "premier";

export type AgreementFacts = {
  number: string;
  business: { legalName: string; tradeName: string; address: string; phone: string; email: string; emergencyPhone: string; serviceHours: string };
  insurance: Record<string, string>;
  renter: { name: string; dob: string | null; address: string | null; phone: string | null; email: string | null; licenseState: string | null; licenseLast4: string | null; licenseExpires: string | null };
  vehicle: { className: string; model: string; year: number | null; vin: string | null; plate: string | null };
  pickup: { location: string; address: string; at: string };
  dropoff: { location: string; address: string; at: string };
  rentalDays: number;
  ratePlan: string;
  tier: string;
  multiplierBps: number;
  averageDailyCents: number;
  rentalCents: number;
  payNowDiscountCents: number;
  youngDriver: { dailyCents: number; totalCents: number } | null;
  delivery: { feeCents: number; address: string | null } | null;
  mileage: { daily: number; total: number; unlimited: boolean; excessCents: number; unlimitedCents: number };
  soc: { target: number; lowChargeFeeCents: number };
  charging: { elected: boolean; dailyCents: number; days: number; totalCents: number };
  extraDriver: { dailyCents: number; totalCents: number } | null;
  waiver: { tier: WaiverTier; dailyCents: number; totalCents: number; prices: Record<WaiverTier, number> };
  taxCents: number;
  taxRateBps: number;
  totalCents: number;
  paidCents: number;
  card: { brand: string; last4: string } | null;
  holdCents: number;
  depositCents: number;
  extras: string[];
};

export type Elections = {
  waiverTier: WaiverTier;
  waiverInitials: string;
  locationInitials: string;
  electronicComms: boolean;
  electronicInitials: string | null;
  longTermInitials: string | null;
};

export type Signature = { signerName: string; signedAt: string; elections: Elections; image?: string | null };

export type Row = [label: string, value: string];

export type Block =
  | { kind: "title"; text: string; sub: string; brand: string }
  | { kind: "meta"; rows: Row[] }
  | { kind: "section"; text: string }
  | { kind: "clause"; heading: string; paragraphs: string[] }
  | { kind: "paragraph"; text: string; tone?: "warning" | "muted" | "strong" }
  | { kind: "rows"; rows: Row[] }
  | { kind: "signature"; rows: Row[]; image?: string | null };

export const isLongTerm = (days: number) => days >= 30;

const signaturePrefix = "data:image/png;base64,";
const pngMagic = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export const signatureImageInput = z
  .string()
  .startsWith(signaturePrefix)
  .max(160000)
  .refine((value) => {
    const bytes = Buffer.from(value.slice(signaturePrefix.length), "base64");
    return bytes.length >= 200 && bytes.length <= 120000 && bytes.subarray(0, 8).equals(pngMagic);
  });

const texts: Record<string, AgreementText> = { zh, en };

export function renderAgreement(locale: string, f: AgreementFacts, signature?: Signature) {
  const T = texts[locale] ?? en;
  const isZh = locale === "zh";
  const L = T.labels;
  const money = formatMoney;
  const or = (value: string | null | undefined, fallback = L.notProvided) => (value && value.trim() ? value : fallback);
  const pending = L.pending;
  const atSigning = L.atSigning;
  const initials = (value: string | null | undefined) => (signature ? or(value, L.notProvided) : atSigning);
  const perDay = (cents: number) => `${money(cents)}${isZh ? "/天" : "/day"}`;
  const days = (n: number) => (isZh ? `${n} 天` : `${n} day${n === 1 ? "" : "s"}`);
  const e = signature?.elections;

  const tierNames: Record<string, string> = isZh
    ? { daily: "日租价", weekly: "周租价", monthly: "月租价" }
    : { daily: "daily rate", weekly: "weekly rate", monthly: "monthly rate" };
  const discountParts: string[] = [];
  if (f.multiplierBps < 10000) discountParts.push(`${tierNames[f.tier] ?? f.tier} · −${((10000 - f.multiplierBps) / 100).toFixed(0)}%`);
  if (f.payNowDiscountCents > 0) discountParts.push(`${isZh ? "预付折扣" : "Pay-now discount"} −${money(f.payNowDiscountCents)}`);

  const waiverRows: Record<WaiverTier, string> = { none: T.exhibitB.rows.decline, basic: T.exhibitB.rows.basic, standard: T.exhibitB.rows.standard, premier: T.exhibitB.rows.premier };
  const waiverName = waiverRows[f.waiver.tier];
  const waiverValue =
    f.waiver.tier === "none"
      ? `${waiverName} · ${money(0)}`
      : `${waiverName} · ${perDay(f.waiver.dailyCents)} × ${days(f.rentalDays)} = ${money(f.waiver.totalCents)}`;
  const chargingValue = f.charging.elected
    ? `${L.elected} · ${perDay(f.charging.dailyCents)} × ${days(f.charging.days)} = ${money(f.charging.totalCents)} · ${f.business.address}`
    : L.declined;
  const mileageValue = f.mileage.unlimited ? (isZh ? "不限里程" : "Unlimited") : `${f.mileage.daily}${isZh ? " 英里/天" : " mi/day"} · ${f.mileage.total}${isZh ? " 英里/租期" : " mi total"}`;
  const excessValue = f.mileage.unlimited
    ? `${isZh ? "不限里程选项" : "Unlimited option"} · ${money(f.mileage.unlimitedCents)}`
    : `${money(f.mileage.excessCents)}${isZh ? "/英里" : "/mile"}`;
  const socValue = `${f.soc.target}% / ${f.soc.target}% · ${money(f.soc.lowChargeFeeCents)}${isZh ? " 每缺少 1%" : " per 1% short"}`;
  const vehicleValue = `${f.vehicle.year ?? ""} Tesla ${f.vehicle.className}`.trim() + ` · VIN ${or(f.vehicle.vin, pending)}`;
  const place = (p: { location: string; address: string; at: string }, deliveryAddress?: string | null) =>
    `${deliveryAddress ? deliveryAddress : `${p.location}, ${p.address}`} · ${p.at}`;
  const licenseValue =
    f.renter.licenseState || f.renter.licenseLast4 || f.renter.licenseExpires
      ? `${or(f.renter.licenseState)} / ${f.renter.licenseLast4 ? `••••${f.renter.licenseLast4}` : L.notProvided} / ${or(f.renter.licenseExpires)}`
      : pending;
  const cardValue = f.card ? `${f.card.brand.toUpperCase()} ••••${f.card.last4} · ${f.renter.name}` : pending;
  const holdValue = f.depositCents > 0 ? `${money(f.holdCents)} (${isZh ? "含儿童座椅押金" : "incl. child-seat deposit"} ${money(f.depositCents)})` : money(f.holdCents);
  const taxValue = `${money(f.taxCents)} (${(f.taxRateBps / 100).toFixed(2)}%)`;
  const totalsValue = `${money(f.totalCents)} · ${isZh ? "已付" : "paid"} ${money(f.paidCents)}`;
  const otherDrivers = f.extraDriver ? `${L.elected} · ${perDay(f.extraDriver.dailyCents)} · ${pending}` : L.notProvided;
  const ageFee = f.youngDriver ? `${perDay(f.youngDriver.dailyCents)} · ${money(f.youngDriver.totalCents)}` : L.notProvided;
  const deliveryValue = f.delivery ? `${money(f.delivery.feeCents)}${f.delivery.address ? ` · ${f.delivery.address}` : ""}` : L.notProvided;
  const travelValue = isZh ? "美国本土 · 未经书面批准不得出境 · 禁止越野" : "Continental U.S. · no cross-border travel without written approval · no off-road";
  const executed = signature ? formatFullDateTime(signature.signedAt, locale) : atSigning;
  const electionValue = e ? (e.electronicComms ? L.electronicAccepted : L.electronicDeclined) : atSigning;
  const mark = (tier: WaiverTier, value: string) => `${f.waiver.tier === tier ? "☑" : "☐"} ${value} · ${tier === "none" ? money(0) : perDay(f.waiver.prices[tier])}`;

  const blocks: Block[] = [
    { kind: "title", brand: T.brand, text: T.title, sub: T.editionLine },
    {
      kind: "meta",
      rows: [
        [L.entity, `${f.business.legalName} · ${f.business.address}`],
        [L.tradeName, f.business.tradeName],
        [L.edition, T.edition],
        [L.booking, f.number],
        [L.executed, executed],
      ],
    },
    { kind: "paragraph", text: T.preface, tone: "muted" },
    { kind: "section", text: L.contractTerms },
    ...T.clauses.map((c) => ({ kind: "clause" as const, heading: c.heading, paragraphs: c.paragraphs })),
    { kind: "section", text: T.exhibitA.title },
    { kind: "paragraph", text: T.exhibitA.intro, tone: "muted" },
    {
      kind: "rows",
      rows: [
        [T.exhibitA.rows.booking, f.number],
        [T.exhibitA.rows.entity, `${f.business.legalName} · ${f.business.address}`],
        [T.exhibitA.rows.contact, `${f.business.phone} · ${f.business.email}`],
        [T.exhibitA.rows.emergency, or(f.business.emergencyPhone, pending)],
        [T.exhibitA.rows.renter, `${f.renter.name} · ${or(f.renter.dob)}`],
        [T.exhibitA.rows.renterContact, `${or(f.renter.address)} · ${or(f.renter.phone)} · ${or(f.renter.email)}`],
        [T.exhibitA.rows.license, licenseValue],
        [T.exhibitA.rows.otherDrivers, otherDrivers],
        [T.exhibitA.rows.vehicle, vehicleValue],
        [T.exhibitA.rows.plate, or(f.vehicle.plate, pending)],
        [T.exhibitA.rows.pickup, place(f.pickup, f.delivery?.address)],
        [T.exhibitA.rows.returnRow, place(f.dropoff, f.delivery?.address)],
        [T.exhibitA.rows.days, `${days(f.rentalDays)} · ${perDay(f.averageDailyCents)} · ${money(f.rentalCents)}`],
        [T.exhibitA.rows.discount, discountParts.length ? discountParts.join(" · ") : L.notProvided],
        [T.exhibitA.rows.ageFee, ageFee],
        [T.exhibitA.rows.deliveryFees, deliveryValue],
        [T.exhibitA.rows.mileage, mileageValue],
        [T.exhibitA.rows.excess, excessValue],
        [T.exhibitA.rows.soc, socValue],
        [T.exhibitA.rows.charging, chargingValue],
        [T.exhibitA.rows.waiver, waiverValue],
        [T.exhibitA.rows.taxes, taxValue],
        [T.exhibitA.rows.totals, totalsValue],
        [T.exhibitA.rows.card, cardValue],
        [T.exhibitA.rows.hold, holdValue],
        [T.exhibitA.rows.extras, f.extras.length ? f.extras.join(" · ") : L.notProvided],
        [T.exhibitA.rows.travel, travelValue],
        [T.exhibitA.rows.changes, L.notProvided],
      ],
    },
    { kind: "section", text: T.exhibitB.title },
    { kind: "paragraph", text: T.exhibitB.warning, tone: "warning" },
    { kind: "paragraph", text: T.exhibitB.intro, tone: "muted" },
    {
      kind: "rows",
      rows: [
        [T.exhibitB.rows.category, `${f.vehicle.className} (${f.vehicle.model})`],
        [T.exhibitB.rows.unit, T.exhibitB.rows.unitValue],
        [T.exhibitB.rows.decline, mark("none", T.exhibitB.tierValues.decline)],
        [T.exhibitB.rows.basic, mark("basic", T.exhibitB.tierValues.basic)],
        [T.exhibitB.rows.standard, mark("standard", T.exhibitB.tierValues.standard)],
        [T.exhibitB.rows.premier, mark("premier", T.exhibitB.tierValues.premier)],
        [T.exhibitB.rows.selected, waiverValue],
        [T.exhibitB.rows.duplicate, L.disclosedHere],
        [T.exhibitB.rows.oral, T.exhibitB.rows.oralValue],
        [T.exhibitB.rows.posted, L.notProvided],
        [L.initials, initials(e?.waiverInitials)],
      ],
    },
    { kind: "paragraph", text: T.exhibitB.exclusionsTitle, tone: "strong" },
    { kind: "paragraph", text: T.exhibitB.exclusions },
    { kind: "paragraph", text: T.exhibitB.attestation, tone: "muted" },
    { kind: "section", text: T.exhibitC.title },
    { kind: "paragraph", text: T.exhibitC.intro, tone: "muted" },
    {
      kind: "rows",
      rows: [
        [T.exhibitC.rows.insurer, or(f.insurance.insurer, pending)],
        [T.exhibitC.rows.policyReference, or(f.insurance.policyReference, pending)],
        [T.exhibitC.rows.effectiveDates, or(f.insurance.effectiveDates, pending)],
        [T.exhibitC.rows.biLimits, [f.insurance.biLimitPerPerson, f.insurance.biLimitPerOccurrence].filter(Boolean).join(" / ") || pending],
        [T.exhibitC.rows.propertyDamageLimit, or(f.insurance.propertyDamageLimit, pending)],
        [T.exhibitC.rows.deductible, or(f.insurance.deductible, pending)],
        [T.exhibitC.rows.driverCategories, or(f.insurance.driverCategories, pending)],
        [T.exhibitC.rows.territory, or(f.insurance.territory, pending)],
        [T.exhibitC.rows.rentalEligibility, or(f.insurance.rentalEligibility, pending)],
        [T.exhibitC.rows.supplementalProducts, or(f.insurance.supplementalProducts, L.notProvided)],
        [T.exhibitC.rows.claimsContact, or(f.insurance.claimsContact, pending)],
        [T.exhibitC.rows.incidentPhone, or(f.insurance.incidentPhone, or(f.business.emergencyPhone, pending))],
        [T.exhibitC.rows.ownerRelationship, or(f.insurance.ownerRelationship, pending)],
      ],
    },
    { kind: "paragraph", text: T.exhibitC.footer, tone: "muted" },
    { kind: "section", text: T.exhibitD.title },
    { kind: "paragraph", text: T.exhibitD.note },
    { kind: "paragraph", text: T.exhibitD.footer, tone: "muted" },
    { kind: "section", text: T.exhibitE.title },
    { kind: "paragraph", text: T.exhibitE.warning, tone: "warning" },
    { kind: "paragraph", text: T.exhibitE.notice },
    {
      kind: "rows",
      rows: [
        [T.exhibitE.rows.locationInitials, initials(e?.locationInitials)],
        [T.exhibitE.rows.oral, T.exhibitE.rows.oralValue],
        [T.exhibitE.rows.returnDate, f.dropoff.at],
        [T.exhibitE.rows.phone, or(f.renter.phone, pending)],
        [T.exhibitE.rows.election, electionValue],
        [T.exhibitE.rows.channel, `${or(f.renter.email)} · ${or(f.renter.phone)}`],
        [T.exhibitE.rows.electionInitials, e?.electronicComms === false ? L.declined : initials(e?.electronicInitials)],
        [T.exhibitE.rows.receipt, signature ? `${L.deliveredOnline} · ${executed}` : atSigning],
      ],
    },
    { kind: "paragraph", text: T.exhibitE.footer, tone: "muted" },
  ];

  if (isLongTerm(f.rentalDays)) {
    blocks.push(
      { kind: "section", text: T.exhibitF.title },
      { kind: "paragraph", text: T.exhibitF.intro, tone: "muted" },
      {
        kind: "rows",
        rows: [
          [T.exhibitF.rows.duration, `${f.pickup.at} → ${f.dropoff.at} · ${days(f.rentalDays)}`],
          [T.exhibitF.rows.renewal, T.exhibitF.rows.renewalValue],
          [T.exhibitF.rows.insurer, or(f.insurance.rentalEligibility, pending)],
          [T.exhibitF.rows.licensing, pending],
          [T.exhibitF.rows.pricing, `${perDay(f.averageDailyCents)} · ${money(f.rentalCents)}${discountParts.length ? ` · ${discountParts.join(" · ")}` : ""}`],
          [T.exhibitF.rows.extensions, L.notProvided],
          [T.exhibitF.rows.charging, chargingValue],
          [T.exhibitF.rows.holds, T.exhibitF.rows.holdsValue],
          [T.exhibitF.rows.waiver, waiverValue],
          [T.exhibitF.rows.signatures, initials(e?.longTermInitials)],
        ],
      },
      { kind: "paragraph", text: T.exhibitF.footer, tone: "muted" },
    );
  }

  blocks.push({
    kind: "signature",
    image: signature?.image ?? null,
    rows: [
      [L.printedName, signature ? signature.signerName : atSigning],
      [L.signature, signature ? `/s/ ${signature.signerName}` : atSigning],
      [L.signedAt, executed],
      [L.staffRecord, `${L.systemRecord} · ${f.number}`],
    ],
  });

  const text = blocks.map(serialize).join("\n\n");
  return { title: `${T.brand} · ${T.title}`, blocks, text, hash: createHash("sha256").update(text).digest("hex") };
}

function serialize(block: Block) {
  switch (block.kind) {
    case "title":
      return `${block.brand}\n${block.text}\n${block.sub}`;
    case "meta":
    case "rows":
    case "signature":
      return block.rows.map(([label, value]) => `${label}: ${value}`).join("\n");
    case "section":
      return `== ${block.text} ==`;
    case "clause":
      return `${block.heading}\n${block.paragraphs.join("\n")}`;
    case "paragraph":
      return block.text;
  }
}
