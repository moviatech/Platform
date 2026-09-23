import "server-only";
import { loadActiveConfig } from "@/features/booking/service";
import { faq } from "@/features/portal/faq-data";
import { guides } from "@/features/portal/guides";
import { liabilityText } from "@/features/pricing/coverage";
import { ratePercent } from "@/features/pricing/quote";
import { createAdminClient } from "@/lib/supabase/admin";
import { rankByRelevance } from "./relevance";

const money = (cents: number) => `$${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`;

type ClassRow = { name: string; model: string; base_daily_rate_cents: number; security_hold_cents: number; seats: number | null; range_miles: number | null };
type LocationRow = { name: string; name_zh: string | null; address: string | null; tax_rate_bps: number | null; support_phone: string | null; support_email: string | null; support_wechat: string | null; support_hours: string | null; support_hours_zh: string | null; pickup_instructions: string | null };

type KnowledgeTable = { title?: string; rows?: string[][] };
type KnowledgeText = { question?: string; answer?: string; tables?: KnowledgeTable[]; note?: string };
type KnowledgeEntry = { id?: string; href?: string; links?: string[]; zh?: KnowledgeText; en?: KnowledgeText };
type Knowledge = { site?: string; entries?: KnowledgeEntry[] };

const knowledgeUrl = "https://www.moviatech.ai/api/assistant/knowledge";
const knowledgeTtl = 3600000;
let knowledgeCache: { at: number; entries: string[] } | null = null;
const websiteLimit = 10;
const portalLimit = 5;
const entryMax = 4500;

const tableText = (tables: KnowledgeTable[] | undefined) => (tables ?? []).map((table) => [table.title, ...(table.rows ?? []).map((row) => row.join(" — "))].filter(Boolean).join("\n")).filter(Boolean).join("\n");

function entryText(site: string, entry: KnowledgeEntry) {
  const lang = (label: string, text: KnowledgeText | undefined) => (text ? [`Q (${label}): ${text.question ?? ""}`, `A (${label}): ${text.answer ?? ""}`, tableText(text.tables), text.note ? `Note (${label}): ${text.note}` : ""] : []);
  return [`[${entry.id ?? ""}]${entry.href ? ` ${/^https?:/i.test(entry.href) ? entry.href : `${site}${entry.href}`}` : ""}`, ...lang("zh", entry.zh), ...lang("en", entry.en), entry.links?.length ? `Official Tesla manual: ${entry.links.join(" | ")}` : ""].filter(Boolean).join("\n");
}

export async function websiteFaq(now = Date.now()) {
  if (knowledgeCache && now - knowledgeCache.at < knowledgeTtl) return knowledgeCache.entries;
  try {
    const response = await fetch(knowledgeUrl, { signal: AbortSignal.timeout(5000), cache: "no-store" });
    if (!response.ok) return knowledgeCache?.entries ?? [];
    const data = (await response.json()) as Knowledge | null;
    const entries = Array.isArray(data?.entries) ? data.entries.filter((entry) => entry && (entry.zh || entry.en)) : [];
    if (!entries.length || entries.length > 2000) return knowledgeCache?.entries ?? [];
    const site = typeof data?.site === "string" ? data.site.replace(/\/$/, "") : "https://www.moviatech.ai";
    knowledgeCache = { at: now, entries: entries.map((entry) => entryText(site, entry).slice(0, entryMax)) };
    return knowledgeCache.entries;
  } catch {
    return knowledgeCache?.entries ?? [];
  }
}

function salesTaxLine(rows: LocationRow[]) {
  const rate = (row: LocationRow) => row.tax_rate_bps ?? 0;
  const taxed = rows.filter((row) => rate(row) > 0);
  const untaxed = rows.filter((row) => rate(row) === 0);
  if (!taxed.length) return "- Sales tax: none. No sales tax is added to any charge; quote prices without mentioning tax.";
  return `- Sales tax by pickup location: ${taxed.map((row) => `${row.name} ${ratePercent(rate(row))}`).join(", ")}${untaxed.length ? `; no sales tax at ${untaxed.map((row) => row.name).join(", ")}` : ""}.`;
}

export async function businessFacts(question = "") {
  const supabase = createAdminClient();
  const [config, { data: classRows }, { data: locationRows }, { data: portal }, websiteEntries] = await Promise.all([
    loadActiveConfig().catch(() => null),
    supabase.from("vehicle_classes").select("name, model, base_daily_rate_cents, security_hold_cents, seats, range_miles").eq("active", true).order("sort_order"),
    supabase.from("locations").select("name, name_zh, address, tax_rate_bps, support_phone, support_email, support_wechat, support_hours, support_hours_zh, pickup_instructions").eq("active", true).order("name"),
    supabase.from("settings").select("value").eq("key", "portal").maybeSingle(),
    websiteFaq(),
  ]);
  const contact = ((portal?.value as { contact?: Record<string, unknown> } | null)?.contact ?? {}) as { phone?: string; phoneAlias?: string; email?: string; wechat?: string; hours?: { en?: string; zh?: string } };
  const sections: string[] = [];

  sections.push(["Company: Movia Technologies, Inc. (brand Movia / 微智驾), Tesla rental with Full Self-Driving (Supervised) included on every vehicle.", "Business status: soft opening; fleet selection and availability may be limited.", "Website: https://www.moviatech.ai · Customer account: https://account.moviatech.ai", contact.phone ? `Main phone (toll-free): ${contact.phone}${contact.phoneAlias ? ` = ${contact.phoneAlias}` : ""}` : "", contact.email ? `Main email: ${contact.email}` : "", contact.wechat ? `WeChat: ${contact.wechat}` : "", contact.hours?.en ? `Hours: ${contact.hours.en} / ${contact.hours.zh ?? ""}` : ""].filter(Boolean).join("\n"));

  sections.push(
    `Locations:\n${((locationRows ?? []) as LocationRow[])
      .map((row) => [`- ${row.name}${row.name_zh ? ` / ${row.name_zh}` : ""}`, row.address ? `  address: ${row.address}` : "", row.support_hours ? `  hours: ${row.support_hours}${row.support_hours_zh ? ` / ${row.support_hours_zh}` : ""}` : "", [row.support_phone, row.support_email, row.support_wechat ? `WeChat ${row.support_wechat}` : null].filter(Boolean).length ? `  contact: ${[row.support_phone, row.support_email, row.support_wechat ? `WeChat ${row.support_wechat}` : null].filter(Boolean).join(" · ")}` : "", row.pickup_instructions ? `  pickup: ${row.pickup_instructions}` : ""].filter(Boolean).join("\n"))
      .join("\n")}`,
  );

  sections.push(
    `Vehicle classes (base daily rate before weekly/monthly discounts; security hold at pickup):\n${((classRows ?? []) as ClassRow[])
      .map((row) => `- ${row.name} (${row.model}): ${money(row.base_daily_rate_cents)}/day, hold ${money(row.security_hold_cents)}${row.seats ? `, ${row.seats} seats` : ""}${row.range_miles ? `, ~${row.range_miles} mi range` : ""}`)
      .join("\n")}`,
  );

  if (config) {
    const c = config.data;
    const tier = (id: string) => c.rateTiers.find((item) => item.id === id);
    const weekly = tier("weekly");
    const monthly = tier("monthly");
    const plan = (id: string) => c.protectionPlans.find((item) => item.id === id);
    const addOn = (id: string) => c.addOns.find((item) => item.id === id);
    const perDay = (id: string) => {
      const item = addOn(id);
      return item && item.kind === "perDay" ? money(item.priceCents) : null;
    };
    const childSeat = addOn("childSeat");
    const unlimited = addOn("unlimitedMiles");
    const excess = Object.entries(c.mileage.excessRateCents).map(([model, cents]) => `${model} ${money(cents)}/mi`).join(", ");
    sections.push(
      [
        "Pricing rules:",
        `- Rental day = 24 hours; any part of a day counts as a full day. Weekly (${weekly?.minDays ?? 7}+ days) rate = ${weekly ? weekly.multiplierBps / 100 : 90}% of daily; monthly (${monthly?.minDays ?? 30}+ days) rate = ${monthly ? monthly.multiplierBps / 100 : 75}% of daily. Max rental ${c.maxRentalDays} days. Booking at least ${c.minLeadHours} hours ahead; pickup/return slots ${c.bookingWindow.start}–${c.bookingWindow.end}. Pay-now discount ${c.payNowDiscountBps / 100}%.`,
        salesTaxLine((locationRows ?? []) as LocationRow[]),
        `- Protection options per day: Liability only ${money(plan("basic")?.dailyCents ?? 0)} (third-party liability, no damage waiver); Liability + damage waiver ${money(plan("standard")?.dailyCents ?? 0)} (deductible ${money(plan("standard")?.deductibleCents ?? 0)}); Liability + damage waiver ${money(plan("premier")?.dailyCents ?? 0)} (no deductible). Only a renter with a U.S. license may decline all of them; a renter with a non-U.S. license must pick Liability only or higher and, with Liability only, must upload proof of their own coverage for rental-vehicle damage before pickup. ${Object.entries(c.protectionSurchargeCents).map(([model, cents]) => `${model} adds ${money(cents)} per day to each plan. `).join("")}The chosen option is charged for every rental day at the daily price, with no cap and no monthly price. The damage waiver in the two higher options covers damage to and theft of the rental vehicle, subject to the deductible of the chosen plan; it does not cover loss or theft of personal belongings in the vehicle, and it does not apply only in the cases listed in Exhibit B of the rental agreement: damage caused by an authorized driver's intentional, willful or reckless conduct, by driving under the influence of alcohol or drugs, by towing or pushing anything, or by driving on an unpaved road when the damage results from the road or driving conditions; damage that happens while the vehicle is used for commercial hire, in conduct chargeable as a felony, in a race or speed test, for driver training, by an unauthorized driver, or outside the United States; and cases where an authorized driver gave fraudulent or materially false information. No other breach of the agreement voids the waiver, so never tell a customer that breaking the agreement in general cancels it. The waiver is optional and is not liability insurance. A renter with a U.S. licence who declines it does not need proof of insurance. A renter with a foreign licence (including one used with an IDP or an English translation) who declines it must upload proof of insurance in the customer portal before pickup, and staff check it at pickup; buying any waiver tier removes that requirement.`,
        `- Liability protection: third-party liability protection at California's minimum limits (bodily injury ${liabilityText.perPerson} per person and ${liabilityText.perAccident} per accident, property damage ${liabilityText.property} per accident) is included only with one of the three paid protection options. A renter who declines all of them gets no liability protection from Movia and relies on their own automobile insurance; liability above those limits may remain with the renter. Never say that liability protection is free or included with every rental.`,
        `- Add-ons: charging package ${perDay("charging") ?? "n/a"}/day (covers charging; low-charge fee waived at return), additional driver ${perDay("driver") ?? "n/a"}/day per driver (each driver verifies a license online or in person at pickup), child seat free with ${money(childSeat?.kind === "free" ? (childSeat.depositCents ?? 0) : 0)} refundable deposit, unlimited miles ${unlimited?.kind === "rentPercent" ? unlimited.percentBps / 100 : 50}% of rent, toll package ${perDay("toll") ?? "n/a"}/day (all tolls included).`,
        `- Mileage: ${c.mileage.allowance.daily} miles per rental day, pooled over the whole rental (allowance = ${c.mileage.allowance.daily} x rental days, for example 7 days = ${c.mileage.allowance.daily * 7} and 30 days = ${c.mileage.allowance.daily * 30}); there is no separate weekly or monthly allowance, and the unlimited-miles add-on removes the limit. Excess ${excess}.`,
        `- Coupon codes: a customer may have a code. It is entered at checkout and takes a percentage or a fixed amount off the rent only, before tax. Dates, minimum days, vehicle, first-booking and whether it combines with weekly or monthly rates and the pay-now discount depend on the code. Never invent a code or its value and never promise that a code will work; if the customer asks for one, say the team will confirm.`,
        `- Charge at return: at least ${c.charge.minReturnLevel}%; otherwise ${money(c.charge.lowChargeFeeCentsPerPercent)} per percentage point below, waived with the charging package.`,
        `- Tolls without the package: actual tolls plus ${money(c.tolls.adminFeeCentsPerDay)} handling per day tolls were used, billed after the toll statement arrives.`,
        `- Late return: ${c.returnGraceMinutes}-minute grace; up to ${c.lateReturn.hourlyCapHours} hours late charged hourly at 1/24 of the daily rate; more than ${c.lateReturn.hourlyCapHours} hours charged as a full day; no separate flat late fee. Extensions must be requested and confirmed in advance.`,
        `- Young driver ${c.youngDriver.minAge}–${c.youngDriver.maxAge}: ${money(c.youngDriver.feeDailyCents)}/day. Minimum age ${c.youngDriver.minAge}.`,
        `- Cancellation (under 30 days): free more than ${c.cancelPolicy.short.freeHours} hours before pickup; within ${c.cancelPolicy.short.freeHours} hours one undiscounted day; no-show up to ${c.cancelPolicy.short.noShowMaxDays} days. Cancellation (30+ days): free more than ${c.cancelPolicy.monthly.freeHours} hours before; ${c.cancelPolicy.monthly.freeHours}–${c.cancelPolicy.monthly.feeHours} hours ${money(c.cancelPolicy.monthly.feeCents)}; ${c.cancelPolicy.monthly.feeHours}–${c.cancelPolicy.monthly.lateHours} hours ${c.cancelPolicy.monthly.lateDays} undiscounted day; under ${c.cancelPolicy.monthly.lateHours} hours ${c.cancelPolicy.monthly.finalDays} days; no-show ${c.cancelPolicy.monthly.noShowDays} days.`,
        `- Booking requests are held for ${c.requestHoldHours} hours pending confirmation; delivery fee ${money(c.deliveryFeeCents)}.`,
        `- Licenses: U.S. licenses verify online (Stripe Identity); non-U.S. licenses are accepted but checked in person at pickup and cannot use self-service pickup. Every non-U.S. license holder brings the original license and the passport; a license that is not in English also needs either an International Driving Permit (IDP) or an English translation, and both are accepted. Mainland China licenses have no IDP, so they use the foreign license plus an English translation.`,
      ].join("\n"),
    );
  }

  const website = rankByRelevance(websiteEntries, (entry) => entry, question, websiteLimit);
  if (website.length) sections.push(`WEBSITE_FAQ (the public answers on moviatech.ai closest to this conversation; they take precedence over STYLE_EXAMPLES, anyone's recollection and the FAQ below, while explicit STAFF_NOTES decisions still stand; every price, percentage, mileage or fee figure in "Pricing rules" above is the live setting and wins over a different figure in any FAQ answer, and so do its rules on what the damage waiver covers, the included liability protection, proof of insurance and license documents; for vehicle-operation questions include the matching "Official Tesla manual" link in the reply):\n${website.join("\n\n")}`);
  const portalFaq = rankByRelevance(faq, (item) => `${item.q.en} ${item.a.en} ${item.q.zh} ${item.a.zh}`, question, portalLimit);
  if (portalFaq.length) sections.push(`FAQ:\n${portalFaq.map((item) => `Q (en): ${item.q.en}\nA (en): ${item.a.en}\nQ (zh): ${item.q.zh}\nA (zh): ${item.a.zh}`).join("\n\n")}`);
  sections.push(`Help guides available in the customer account (Help Center → Guides):\n${guides.map((guide) => `- ${guide.title.en} / ${guide.title.zh}: ${guide.summary.en}`).join("\n")}`);
  return sections.join("\n\n");
}
