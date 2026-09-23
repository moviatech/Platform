import "server-only";
import { loadActiveConfig } from "@/features/booking/service";
import { faq } from "@/features/portal/faq-data";
import { guides } from "@/features/portal/guides";
import { createAdminClient } from "@/lib/supabase/admin";

const money = (cents: number) => `$${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`;

type ClassRow = { name: string; model: string; base_daily_rate_cents: number; security_hold_cents: number; seats: number | null; range_miles: number | null };
type LocationRow = { name: string; name_zh: string | null; address: string | null; tax_rate_bps: number | null; support_phone: string | null; support_email: string | null; support_wechat: string | null; support_hours: string | null; support_hours_zh: string | null; pickup_instructions: string | null };

type KnowledgeTable = { title?: string; rows?: string[][] };
type KnowledgeText = { question?: string; answer?: string; tables?: KnowledgeTable[]; note?: string };
type KnowledgeEntry = { id?: string; href?: string; links?: string[]; zh?: KnowledgeText; en?: KnowledgeText };
type Knowledge = { site?: string; entries?: KnowledgeEntry[] };

const knowledgeUrl = "https://www.moviatech.ai/api/assistant/knowledge";
const knowledgeTtl = 3600000;
let knowledgeCache: { at: number; text: string } | null = null;

const tableText = (tables: KnowledgeTable[] | undefined) => (tables ?? []).map((table) => [table.title, ...(table.rows ?? []).map((row) => row.join(" — "))].filter(Boolean).join("\n")).filter(Boolean).join("\n");

function entryText(site: string, entry: KnowledgeEntry) {
  const lang = (label: string, text: KnowledgeText | undefined) => (text ? [`Q (${label}): ${text.question ?? ""}`, `A (${label}): ${text.answer ?? ""}`, tableText(text.tables), text.note ? `Note (${label}): ${text.note}` : ""] : []);
  return [`[${entry.id ?? ""}]${entry.href ? ` ${/^https?:/i.test(entry.href) ? entry.href : `${site}${entry.href}`}` : ""}`, ...lang("zh", entry.zh), ...lang("en", entry.en), entry.links?.length ? `Official Tesla manual: ${entry.links.join(" | ")}` : ""].filter(Boolean).join("\n");
}

export async function websiteFaq(now = Date.now()) {
  if (knowledgeCache && now - knowledgeCache.at < knowledgeTtl) return knowledgeCache.text;
  try {
    const response = await fetch(knowledgeUrl, { signal: AbortSignal.timeout(8000), cache: "no-store" });
    if (!response.ok) return knowledgeCache?.text ?? "";
    const data = (await response.json()) as Knowledge | null;
    const entries = Array.isArray(data?.entries) ? data.entries.filter((entry) => entry && (entry.zh || entry.en)) : [];
    if (!entries.length) return knowledgeCache?.text ?? "";
    const site = typeof data?.site === "string" ? data.site.replace(/\/$/, "") : "https://www.moviatech.ai";
    const text = entries.map((entry) => entryText(site, entry)).join("\n\n");
    if (text.length > 400000) return knowledgeCache?.text ?? "";
    knowledgeCache = { at: now, text };
    return text;
  } catch {
    return knowledgeCache?.text ?? "";
  }
}

export async function businessFacts() {
  const supabase = createAdminClient();
  const [config, { data: classRows }, { data: locationRows }, { data: portal }, faqText] = await Promise.all([
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
        `- Rental day = 24 hours; any part of a day counts as a full day. Weekly (${weekly?.minDays ?? 7}+ days) rate = ${weekly ? weekly.multiplierBps / 100 : 75}% of daily; monthly (${monthly?.minDays ?? 30}+ days) rate = ${monthly ? monthly.multiplierBps / 100 : 55}% of daily. Max rental ${c.maxRentalDays} days. Booking at least ${c.minLeadHours} hours ahead; pickup/return slots ${c.bookingWindow.start}–${c.bookingWindow.end}. Pay-now discount ${c.payNowDiscountBps / 100}%.`,
        `- Sales tax by pickup location: ${((locationRows ?? []) as LocationRow[]).map((row) => `${row.name} ${((row.tax_rate_bps ?? 0) / 100).toFixed(2)}%`).join(", ")}.`,
        `- Damage waiver plans per day / per month (deductible): basic ${money(plan("basic")?.dailyCents ?? 0)} / ${money(plan("basic")?.monthlyCents ?? 0)} (${money(plan("basic")?.deductibleCents ?? 0)}), standard ${money(plan("standard")?.dailyCents ?? 0)} / ${money(plan("standard")?.monthlyCents ?? 0)} (${money(plan("standard")?.deductibleCents ?? 0)}), premier ${money(plan("premier")?.dailyCents ?? 0)} / ${money(plan("premier")?.monthlyCents ?? 0)} (no deductible). Daily waiver is charged for at most ${c.protectionChargeCapDays} days per rental. Declining the waiver requires the renter's own proof of auto insurance before pickup. The waiver is not liability insurance.`,
        `- Add-ons: charging package ${perDay("charging") ?? "n/a"}/day (covers charging; low-charge fee waived at return), additional driver ${perDay("driver") ?? "n/a"}/day per driver (each driver verifies a license online or in person at pickup), child seat free with ${money(childSeat?.kind === "free" ? (childSeat.depositCents ?? 0) : 0)} refundable deposit, unlimited miles ${unlimited?.kind === "rentPercent" ? unlimited.percentBps / 100 : 50}% of rent, toll package ${perDay("toll") ?? "n/a"}/day (all tolls included).`,
        `- Mileage: ${c.mileage.allowance.daily} mi/day, ${c.mileage.allowance.weekly} mi/week, ${c.mileage.allowance.monthly} mi/month included; excess ${excess}.`,
        `- Charge at return: at least ${c.charge.minReturnLevel}%; otherwise ${money(c.charge.lowChargeFeeCentsPerPercent)} per percentage point below, waived with the charging package.`,
        `- Tolls without the package: actual tolls plus ${money(c.tolls.adminFeeCentsPerDay)} handling per day tolls were used, billed after the toll statement arrives.`,
        `- Late return: ${c.returnGraceMinutes}-minute grace; up to ${c.lateReturn.hourlyCapHours} hours late charged hourly at 1/24 of the daily rate; more than ${c.lateReturn.hourlyCapHours} hours charged as a full day; no separate flat late fee. Extensions must be requested and confirmed in advance.`,
        `- Young driver ${c.youngDriver.minAge}–${c.youngDriver.maxAge}: ${money(c.youngDriver.feeDailyCents)}/day. Minimum age ${c.youngDriver.minAge}.`,
        `- Cancellation (under 30 days): free more than ${c.cancelPolicy.short.freeHours} hours before pickup; within ${c.cancelPolicy.short.freeHours} hours one undiscounted day; no-show up to ${c.cancelPolicy.short.noShowMaxDays} days. Cancellation (30+ days): free more than ${c.cancelPolicy.monthly.freeHours} hours before; ${c.cancelPolicy.monthly.freeHours}–${c.cancelPolicy.monthly.feeHours} hours ${money(c.cancelPolicy.monthly.feeCents)}; ${c.cancelPolicy.monthly.feeHours}–${c.cancelPolicy.monthly.lateHours} hours ${c.cancelPolicy.monthly.lateDays} undiscounted day; under ${c.cancelPolicy.monthly.lateHours} hours ${c.cancelPolicy.monthly.finalDays} days; no-show ${c.cancelPolicy.monthly.noShowDays} days.`,
        `- Booking requests are held for ${c.requestHoldHours} hours pending confirmation; delivery fee ${money(c.deliveryFeeCents)}.`,
        `- Licenses: U.S. licenses verify online (Stripe Identity); international licenses or foreign licenses with an English translation are accepted but checked in person at pickup and cannot use self-service pickup.`,
      ].join("\n"),
    );
  }

  if (faqText) sections.push(`WEBSITE_FAQ (public answers published on moviatech.ai; they take precedence over STYLE_EXAMPLES, anyone's recollection and the FAQ below, while explicit STAFF_NOTES decisions still stand; for vehicle-operation questions include the matching "Official Tesla manual" link in the reply):\n${faqText}`);
  sections.push(`FAQ:\n${faq.map((item) => `Q (en): ${item.q.en}\nA (en): ${item.a.en}\nQ (zh): ${item.q.zh}\nA (zh): ${item.a.zh}`).join("\n\n")}`);
  sections.push(`Help guides available in the customer account (Help Center → Guides):\n${guides.map((guide) => `- ${guide.title.en} / ${guide.title.zh}: ${guide.summary.en}`).join("\n")}`);
  return sections.join("\n\n");
}
