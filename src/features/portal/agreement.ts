import { createHash } from "node:crypto";
import { z } from "zod";
import { liabilityText } from "@/features/pricing/coverage";
import { ratePercent } from "@/features/pricing/quote";
import { formatFullDateTime, formatMoney } from "@/lib/utils/format";
import { en } from "./agreement-text/en";
import { zh } from "./agreement-text/zh";
import type { AgreementText } from "./agreement-text/types";
import { inspectSignaturePng } from "./signature-png";

export const agreementVersion = "2026-11-20.2";

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
  otherDiscountCents: number;
  youngDriver: { dailyCents: number; totalCents: number } | null;
  delivery: { feeCents: number } | null;
  handover: { method: string; address: string | null };
  mileage: { daily: number; total: number; unlimited: boolean; excessCents: number; unlimitedCents: number };
  published: { mileageDaily: number; excessStandardCents: number; excessTruckCents: number; waiverCents: number[]; waiverTruckCents: number[] };
  soc: { target: number; lowChargeFeeCents: number };
  charging: { elected: boolean; dailyCents: number; days: number; totalCents: number };
  extraDriver: { dailyCents: number; totalCents: number; names: string[]; count: number; spouse: boolean } | null;
  waiver: { tier: WaiverTier; dailyCents: number; totalCents: number; prices: Record<WaiverTier, number>; deductibles: Record<WaiverTier, number> };
  taxCents: number;
  taxRateBps: number;
  totalCents: number;
  paidCents: number;
  card: { brand: string; last4: string } | null;
  holdCents: number;
  depositCents: number;
  extras: string[];
  specialTerms: string | null;
  licenseKind: string | null;
  status: string;
  confirmedAt: string | null;
  insuranceState: string;
  seenAt: string;
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
  | { kind: "terms"; label: string; text: string }
  | { kind: "signature"; rows: Row[]; image?: string | null };

export const isLongTerm = (days: number) => days >= 30;

const signaturePrefix = "data:image/png;base64,";

export const signatureImageInput = z
  .string()
  .startsWith(signaturePrefix)
  .max(160000)
  .refine((value) => {
    const bytes = Buffer.from(value.slice(signaturePrefix.length), "base64");
    return bytes.length >= 200 && bytes.length <= 120000 && inspectSignaturePng(bytes) !== "bad";
  });

const texts: Record<string, AgreementText> = { zh, en };

export const agreementEdition = (locale: string) => (texts[locale] ?? en).edition;

export const recordHints = {
  termsLabels: [en.exhibitA.rows.changes, zh.exhibitA.rows.changes],
  termsEnds: [`== ${en.exhibitB.title} ==`, `== ${zh.exhibitB.title} ==`],
  colonLabels: [en.exhibitE.rows.extensions, zh.exhibitE.rows.extensions].filter((label) => label.includes(": ")),
};

export type AgreementChannel = "portal" | "device" | "external";

export function renderAgreement(locale: string, f: AgreementFacts, signature?: Signature, template = false, channel: AgreementChannel = "portal") {
  const T = texts[locale] ?? en;
  const isZh = locale === "zh";
  const L = T.labels;
  const money = formatMoney;
  const or = (value: string | null | undefined, fallback = L.notProvided) => (value && value.trim() ? value : fallback);
  const pending = L.pending;
  const blank = "__________";
  const atSigning = channel === "external" ? blank : L.atSigning;
  const missing = channel === "external" ? blank : L.notProvided;
  const later = channel === "external" ? blank : pending;
  const initials = (value: string | null | undefined) => (signature ? or(value, L.notProvided) : atSigning);
  const perDay = (cents: number) => `${money(cents)}${isZh ? "/天" : "/day"}`;
  const days = (n: number) => (isZh ? `${n} 天` : `${n} day${n === 1 ? "" : "s"}`);
  const e = signature?.elections;
  const v = (value: string) => (template ? blank : value);

  const tierNames: Record<string, string> = isZh
    ? { daily: "日租价", weekly: "周租价", monthly: "月租价" }
    : { daily: "daily rate", weekly: "weekly rate", monthly: "monthly rate" };
  const discountParts: string[] = [];
  if (f.multiplierBps < 10000) discountParts.push(`${tierNames[f.tier] ?? f.tier} · −${((10000 - f.multiplierBps) / 100).toFixed(0)}%`);
  if (f.payNowDiscountCents > 0) discountParts.push(`${isZh ? "预付折扣" : "Pay-now discount"} −${money(f.payNowDiscountCents)}`);
  if (f.otherDiscountCents > 0) discountParts.push(`${isZh ? "其他优惠" : "Other discounts"} −${money(f.otherDiscountCents)}`);

  const waiverRows: Record<WaiverTier, string> = { none: T.exhibitB.rows.decline, basic: T.exhibitB.rows.basic, standard: T.exhibitB.rows.standard, premier: T.exhibitB.rows.premier };
  const waiverName = waiverRows[f.waiver.tier];
  const waiverValue =
    f.waiver.tier === "none"
      ? `${waiverName} · ${money(0)}`
      : `${waiverName} · ${perDay(f.waiver.dailyCents)} × ${days(f.rentalDays)} = ${money(f.waiver.totalCents)}`;
  const chargingValue = f.charging.elected
    ? `${L.elected} · ${perDay(f.charging.dailyCents)} × ${days(f.charging.days)} = ${money(f.charging.totalCents)} · ${f.business.address}`
    : L.declined;
  const mileageValue = template
    ? `${f.mileage.daily}${isZh ? " 英里/天 · " : " mi/day · "}${blank}`
    : f.mileage.unlimited
      ? isZh
        ? "不限里程"
        : "Unlimited"
      : `${f.mileage.daily}${isZh ? " 英里/天" : " mi/day"} · ${f.mileage.total}${isZh ? " 英里/租期" : " mi total"}`;
  const excessValue = f.mileage.unlimited
    ? `${isZh ? "不限里程选项" : "Unlimited option"} · ${money(f.mileage.unlimitedCents)}`
    : `${money(f.mileage.excessCents)}${isZh ? "/英里" : "/mile"}`;
  const socValue = `${pending} / ${f.soc.target}% · ${f.charging.elected && !template ? T.exhibitA.values.chargingWaived : `${money(f.soc.lowChargeFeeCents)}${isZh ? " 每缺少 1%" : " per 1% short"}`}`;
  const vehicleValue = `${f.vehicle.year ?? ""} Tesla ${f.vehicle.className}`.trim() + ` · VIN ${or(f.vehicle.vin, pending)}`;
  const place = (p: { location: string; address: string; at: string }) => `${f.handover.address ? f.handover.address : `${p.location}, ${p.address}`} · ${p.at}`;
  const licenseValue =
    f.renter.licenseState || f.renter.licenseLast4 || f.renter.licenseExpires
      ? `${or(f.renter.licenseState, missing)} / ${f.renter.licenseLast4 ? `••••${f.renter.licenseLast4}` : missing} / ${or(f.renter.licenseExpires, missing)}`
      : later;
  const cardValue = f.card ? `${f.card.brand.toUpperCase()} ••••${f.card.last4} · ${f.renter.name}` : T.exhibitA.values.notRegistered;
  const holdValue = f.depositCents > 0 ? `${money(f.holdCents)} (${isZh ? "含儿童座椅押金" : "incl. child-seat deposit"} ${money(f.depositCents)})` : money(f.holdCents);
  const taxRate = ratePercent(f.taxRateBps);
  const untaxed = f.taxRateBps === 0 && f.taxCents === 0;
  const taxValue = untaxed ? (isZh ? "不收取" : "None") : `${money(f.taxCents)} (${taxRate})`;
  const taxNote = untaxed
    ? template
      ? isZh
        ? "本取车地目前不收取销售税。"
        : "No sales tax is charged at this pickup location at present."
      : isZh
        ? "本订单不收取销售税。"
        : "No sales tax applies to this booking."
    : isZh
      ? `本取车地展示的 ${taxRate} 税率，不意味着所有增值服务或其他取车地均一律适用该税率。`
      : `The ${taxRate} rate shown for this pickup location is not a promise that every add-on or another pickup location is taxable at that rate.`;
  const totalsValue = `${money(f.totalCents)} · ${isZh ? "已付" : "paid"} ${money(f.paidCents)}`;
  const paidDrivers = f.extraDriver ? f.extraDriver.count - (f.extraDriver.spouse ? 1 : 0) : 0;
  const driverFee = f.extraDriver ? [paidDrivers > 0 ? `${paidDrivers} × ${perDay(f.extraDriver.dailyCents)}` : null, f.extraDriver.spouse ? L.spouseFree : null].filter(Boolean).join(" · ") : "";
  const otherDrivers = f.extraDriver ? `${f.extraDriver.names.length ? f.extraDriver.names.join(", ") : L.elected} · ${driverFee}${f.extraDriver.names.length ? "" : ` · ${channel === "external" ? blank : isZh ? "姓名交车时登记" : "name recorded at handover"}`}` : L.notProvided;
  const ageFee = f.youngDriver ? `${perDay(f.youngDriver.dailyCents)} · ${money(f.youngDriver.totalCents)}` : L.notProvided;
  const deliveryFeeCents = f.delivery?.feeCents ?? (f.handover.method === "DELIVERY" ? 0 : null);
  const deliveryValue = deliveryFeeCents === null ? L.notProvided : `${money(deliveryFeeCents)}${f.handover.address ? ` · ${f.handover.address}` : ""}`;
  const travelValue = isZh ? "美国本土 · 未经书面批准不得出境 · 禁止越野" : "Continental U.S. · no cross-border travel without written approval · no off-road";
  const executed = signature ? formatFullDateTime(signature.signedAt) : atSigning;
  const V = T.exhibitA.values;
  const statusValue = V.status[["REQUESTED", "PENDING_PAYMENT"].includes(f.status) ? "pending" : f.status === "CONFIRMED" ? "confirmed" : f.status === "ACTIVE" ? "active" : f.status === "COMPLETED" ? "completed" : "cancelled"];
  const confirmationValue = f.confirmedAt ? `${f.confirmedAt} · ${f.number}` : `${f.number} · ${isZh ? "确认后书面通知" : "written confirmation to follow"}`;
  const owed = Math.max(0, f.totalCents - f.paidCents);
  const paymentDueValue = owed === 0 && f.totalCents > 0 ? V.paidInFull : f.ratePlan === "PAY_NOW" ? `${V.prepaid} · ${money(owed)}` : `${V.dueAtPickup} · ${f.pickup.at} · ${V.dueMethod}`;
  const cancellationValue = `${isLongTerm(f.rentalDays) ? V.cancelLong : V.cancelShort}${f.specialTerms ? ` · ${V.cancelSpecial}` : ""}`;
  const coverageValue = f.waiver.tier === "none" && (f.licenseKind ?? "US") !== "US" ? V.coverageUpgrade : (V.coverage[f.insuranceState] ?? f.insuranceState);
  const electionValue = e ? (e.electronicComms ? L.electronicAccepted : L.electronicDeclined) : atSigning;
  const dollars = (cents: number) => `$${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`;
  const truckPrice = (tier: WaiverTier) => f.published.waiverTruckCents[["basic", "standard", "premier"].indexOf(tier)] ?? 0;
  const tierPrice = (tier: WaiverTier) => (template && truckPrice(tier) !== f.waiver.prices[tier] ? `${perDay(f.waiver.prices[tier])} (Cybertruck ${perDay(truckPrice(tier))})` : perDay(f.waiver.prices[tier]));
  const mark = (tier: WaiverTier, value: string) => `${!template && f.waiver.tier === tier ? "☑" : "☐"} ${value.replace("{amount}", money(f.waiver.deductibles[tier]))} · ${tier === "none" ? money(0) : tierPrice(tier)}`;
  const stated = [f.insurance.biLimitPerPerson, f.insurance.biLimitPerOccurrence, f.insurance.propertyDamageLimit].map((value) => (value ?? "").trim());
  const limits = stated.every(Boolean) ? { perPerson: stated[0], perAccident: stated[1], property: stated[2] } : liabilityText;
  const fill = (text: string) =>
    text
      .replace("{taxNote}", taxNote)
      .replace("{liabilityPerPerson}", limits.perPerson)
      .replace("{liabilityPerAccident}", limits.perAccident)
      .replace("{liabilityProperty}", limits.property)
      .replace("{mileageDaily}", String(f.published.mileageDaily))
      .replace("{excessStandard}", `$${(f.published.excessStandardCents / 100).toFixed(2)}`)
      .replace("{excessTruck}", `$${(f.published.excessTruckCents / 100).toFixed(2)}`)
      .replace("{waiverPrices}", f.published.waiverCents.map(dollars).join("/"))
      .replace("{waiverTruckPrices}", f.published.waiverTruckCents.map(dollars).join("/"))
      .replace("{lowChargeFee}", `$${(f.soc.lowChargeFeeCents / 100).toFixed(2)}`);

  const blocks: Block[] = [
    { kind: "title", brand: T.brand, text: T.title, sub: T.editionLine },
    {
      kind: "meta",
      rows: [
        [L.entity, `${f.business.legalName} · ${f.business.address}`],
        [L.tradeName, f.business.tradeName],
        [L.edition, T.edition],
        [L.booking, v(f.number)],
        [L.executed, executed],
      ],
    },
    { kind: "paragraph", text: T.preface, tone: "muted" },
    { kind: "section", text: L.contractTerms },
    ...T.clauses.map((c) => ({ kind: "clause" as const, heading: c.heading, paragraphs: c.paragraphs.map(fill) })),
    { kind: "section", text: T.exhibitA.title },
    { kind: "paragraph", text: T.exhibitA.intro, tone: "muted" },
    {
      kind: "rows",
      rows: [
        [T.exhibitA.rows.booking, v(f.number)],
        [T.exhibitA.rows.status, v(statusValue)],
        [T.exhibitA.rows.confirmation, v(confirmationValue)],
        [T.exhibitA.rows.entity, `${f.business.legalName} · ${f.business.address}`],
        [T.exhibitA.rows.contact, `${f.business.phone} · ${f.business.email}`],
        [T.exhibitA.rows.emergency, `${or(f.business.emergencyPhone, f.business.phone)} · ${T.exhibitA.rows.emergencyNote}`],
        [T.exhibitA.rows.renter, v(`${f.renter.name} · ${or(f.renter.dob, missing)}`)],
        [T.exhibitA.rows.renterContact, v(`${or(f.renter.address, missing)} · ${or(f.renter.phone, missing)} · ${or(f.renter.email, missing)}`)],
        [T.exhibitA.rows.license, v(licenseValue)],
        [T.exhibitA.rows.otherDrivers, v(otherDrivers)],
        [T.exhibitA.rows.vehicle, v(vehicleValue)],
        [T.exhibitA.rows.plate, v(or(f.vehicle.plate, pending))],
        [T.exhibitA.rows.pickup, v(place(f.pickup))],
        [T.exhibitA.rows.returnRow, v(place(f.dropoff))],
        [T.exhibitA.rows.days, v(`${days(f.rentalDays)} · ${perDay(f.averageDailyCents)} · ${money(f.rentalCents)}`)],
        [T.exhibitA.rows.discount, v(discountParts.length ? discountParts.join(" · ") : L.notProvided)],
        [T.exhibitA.rows.ageFee, v(ageFee)],
        [T.exhibitA.rows.deliveryFees, v(deliveryValue)],
        [T.exhibitA.rows.mileage, mileageValue],
        [T.exhibitA.rows.excess, v(excessValue)],
        [T.exhibitA.rows.soc, socValue],
        [T.exhibitA.rows.charging, v(chargingValue)],
        [T.exhibitA.rows.waiver, v(waiverValue)],
        [T.exhibitA.rows.coverageDocs, v(coverageValue)],
        [T.exhibitA.rows.taxes, v(taxValue)],
        [T.exhibitA.rows.totals, v(totalsValue)],
        [T.exhibitA.rows.paymentDue, v(paymentDueValue)],
        [T.exhibitA.rows.card, v(cardValue)],
        [T.exhibitA.rows.hold, v(holdValue)],
        [T.exhibitA.rows.extras, v(f.extras.length ? f.extras.join(" · ") : L.notProvided)],
        [T.exhibitA.rows.travel, travelValue],
        [T.exhibitA.rows.cancellation, v(cancellationValue)],
        ...(template || !f.specialTerms ? [[T.exhibitA.rows.changes, L.notProvided] as Row] : []),
      ],
    },
    ...(!template && f.specialTerms ? [{ kind: "terms" as const, label: T.exhibitA.rows.changes, text: f.specialTerms }] : []),
    { kind: "section", text: T.exhibitB.title },
    { kind: "paragraph", text: T.exhibitB.warning, tone: "warning" },
    { kind: "paragraph", text: T.exhibitB.intro, tone: "muted" },
    {
      kind: "rows",
      rows: [
        [T.exhibitB.rows.category, v(`${f.vehicle.className} (${f.vehicle.model})`)],
        [T.exhibitB.rows.unit, T.exhibitB.rows.unitValue],
        [T.exhibitB.rows.decline, mark("none", T.exhibitB.tierValues.decline)],
        [T.exhibitB.rows.basic, mark("basic", T.exhibitB.tierValues.basic)],
        [T.exhibitB.rows.standard, mark("standard", T.exhibitB.tierValues.standard)],
        [T.exhibitB.rows.premier, mark("premier", T.exhibitB.tierValues.premier)],
        [T.exhibitB.rows.selected, v(waiverValue)],
        [T.exhibitB.rows.duplicate, L.disclosedHere],
        [T.exhibitB.rows.oral, channel === "device" ? T.exhibitB.rows.oralInPerson : T.exhibitB.rows.oralValue],
        [T.exhibitB.rows.posted, L.notProvided],
        [L.initials, initials(e?.waiverInitials)],
      ],
    },
    { kind: "paragraph", text: T.exhibitB.exclusionsTitle, tone: "strong" },
    { kind: "paragraph", text: T.exhibitB.exclusions },
    { kind: "paragraph", text: T.exhibitB.attestation, tone: "muted" },
    { kind: "section", text: T.exhibitC.title },
    { kind: "paragraph", text: T.exhibitC.note },
    { kind: "paragraph", text: T.exhibitC.footer, tone: "muted" },
    { kind: "section", text: T.exhibitD.title },
    { kind: "paragraph", text: T.exhibitD.warning, tone: "warning" },
    { kind: "paragraph", text: T.exhibitD.notice },
    {
      kind: "rows",
      rows: [
        [T.exhibitD.rows.locationInitials, initials(e?.locationInitials)],
        [T.exhibitD.rows.oral, channel === "device" ? T.exhibitD.rows.oralInPerson : T.exhibitD.rows.oralValue],
        [T.exhibitD.rows.returnDate, v(f.dropoff.at)],
        [T.exhibitD.rows.phone, v(or(f.renter.phone, later))],
        [T.exhibitD.rows.election, electionValue],
        [T.exhibitD.rows.channel, v(`${or(f.renter.email, missing)} · ${or(f.renter.phone, missing)}`)],
        [T.exhibitD.rows.electionInitials, e?.electronicComms === false ? L.declined : initials(e?.electronicInitials)],
        [T.exhibitD.rows.receipt, signature ? `${L.deliveredOnline} · ${executed}` : L.providedForReview],
      ],
    },
    { kind: "paragraph", text: T.exhibitD.footer, tone: "muted" },
  ];

  if (template || isLongTerm(f.rentalDays)) {
    blocks.push(
      { kind: "section", text: T.exhibitE.title },
      { kind: "paragraph", text: T.exhibitE.intro, tone: "muted" },
      {
        kind: "rows",
        rows: [
          [T.exhibitE.rows.duration, v(`${f.pickup.at} → ${f.dropoff.at} · ${days(f.rentalDays)}`)],
          [T.exhibitE.rows.renewal, T.exhibitE.rows.renewalValue],
          [T.exhibitE.rows.pricing, v(`${perDay(f.averageDailyCents)} · ${money(f.rentalCents)}${discountParts.length ? ` · ${discountParts.join(" · ")}` : ""}`)],
          [T.exhibitE.rows.extensions, L.notProvided],
          [T.exhibitE.rows.charging, v(chargingValue)],
          [T.exhibitE.rows.holds, T.exhibitE.rows.holdsValue],
          [T.exhibitE.rows.waiver, v(waiverValue)],
          [T.exhibitE.rows.signatures, initials(e?.longTermInitials)],
        ],
      },
      { kind: "paragraph", text: T.exhibitE.footer, tone: "muted" },
    );
  }

  blocks.push({
    kind: "signature",
    image: signature?.image ?? null,
    rows: [
      [L.printedName, signature ? signature.signerName : atSigning],
      [L.signature, signature ? `/s/ ${signature.signerName}` : atSigning],
      [L.signedAt, executed],
      [L.staffRecord, `${channel === "device" ? L.deviceRecord : channel === "external" ? blank : L.systemRecord} · ${v(f.number)}`],
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
    case "terms":
      return `${block.label}:\n${block.text}`;
    case "clause":
      return `${block.heading}\n${block.paragraphs.join("\n")}`;
    case "paragraph":
      return block.text;
  }
}
