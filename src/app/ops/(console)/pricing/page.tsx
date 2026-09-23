import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/ops/PageHeader";
import { loadActiveConfig } from "@/features/booking/service";
import { zonedParts } from "@/features/booking/time";
import { removeRateOverride } from "@/features/pricing/actions";
import { ClassPricingForm, OverrideForm } from "@/features/pricing/PricingForms";
import { can, requirePagePermission } from "@/lib/auth/staff";
import { createClient } from "@/lib/supabase/server";
import { formatMoney } from "@/lib/utils/format";

export const metadata: Metadata = { title: "Pricing" };

export default async function PricingPage() {
  const session = await requirePagePermission("pricing.view");
  const t = await getTranslations("pricing");
  const reservations = await getTranslations("reservations");
  const locale = await getLocale();
  const editable = can(session, "pricing.edit");

  const supabase = await createClient();
  const today = zonedParts(new Date(), "America/Los_Angeles").date;
  const [{ data: classes }, { data: overrides }, config] = await Promise.all([
    supabase.from("vehicle_classes").select("id, name, name_zh, base_daily_rate_cents, security_hold_cents, buffer_hours, active").order("sort_order"),
    supabase.from("rate_overrides").select("id, class_id, date_from, date_to, daily_rate_cents, note").gte("date_to", today).order("date_from"),
    loadActiveConfig(),
  ]);
  const rows = (classes ?? []).map((item) => ({ ...item, name: locale === "zh" ? (item.name_zh ?? item.name) : item.name }));
  const nameOf = (id: string) => rows.find((item) => item.id === id)?.name ?? "";

  return (
    <>
      <PageHeader title={t("title")} lead={t("lead")} />
      <section className="card mb-6 divide-y divide-ink/[0.06] overflow-hidden">
        {rows.map((item) => (
          <ClassPricingForm key={item.id} item={item} editable={editable} />
        ))}
      </section>

      <h2 className="mb-1 text-sm font-semibold">{t("overrides")}</h2>
      <section className="card mb-6 p-5">
        {(overrides ?? []).length > 0 && (
          <ul className="mb-5 divide-y divide-ink/[0.06]">
            {(overrides ?? []).map((item) => (
              <li key={item.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5 text-[13px]">
                <span>
                  <span className="font-medium">{nameOf(item.class_id)}</span>
                  <span className="text-muted"> · {item.date_from} → {item.date_to}</span>
                  {item.note ? <span className="text-muted"> · {item.note}</span> : null}
                </span>
                <span className="flex items-center gap-3">
                  <span className="font-semibold tabular-nums">{formatMoney(item.daily_rate_cents)}</span>
                  {editable && (
                    <form action={removeRateOverride}>
                      <input type="hidden" name="overrideId" value={item.id} />
                      <input type="hidden" name="classId" value={item.class_id} />
                      <button type="submit" className="rounded-pill px-2.5 py-1 text-xs text-status-danger hover:bg-status-danger/10">
                        {t("remove")}
                      </button>
                    </form>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
        {editable && <OverrideForm classes={rows.map((item) => ({ id: item.id, name: item.name }))} today={today} />}
      </section>

      <h2 className="mb-1 text-sm font-semibold">{t("rules", { version: config.version })}</h2>
      <section className="card grid gap-x-10 gap-y-5 p-6 text-[13px] sm:grid-cols-2">
        <div>
          <h3 className="mb-2 text-xs font-medium tracking-wide text-muted">{t("tiers")}</h3>
          <ul className="flex flex-col gap-1">
            {config.data.rateTiers.map((tier) => (
              <li key={tier.id} className="flex justify-between">
                <span>≥ {tier.minDays} {t("days")}</span>
                <span className="tabular-nums">× {(tier.multiplierBps / 10000).toFixed(2)}</span>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h3 className="mb-2 text-xs font-medium tracking-wide text-muted">{reservations("form.protection")}</h3>
          <ul className="flex flex-col gap-1">
            {config.data.protectionPlans.map((plan) => (
              <li key={plan.id} className="flex justify-between">
                <span>{reservations(`protection.${plan.id}`)}</span>
                <span className="tabular-nums">{formatMoney(plan.dailyCents)} / {t("day")} · {formatMoney(plan.monthlyCents)} / {t("month")}</span>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h3 className="mb-2 text-xs font-medium tracking-wide text-muted">{reservations("form.addOns")}</h3>
          <ul className="flex flex-col gap-1">
            {config.data.addOns.map((item) => (
              <li key={item.id} className="flex justify-between">
                <span>{reservations(`addOn.${item.id}`)}</span>
                <span className="tabular-nums">
                  {item.kind === "perDay" ? `${formatMoney(item.priceCents)} / ${t("day")}` : item.kind === "rentPercent" ? `${item.percentBps / 100}%` : formatMoney(0)}
                </span>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h3 className="mb-2 text-xs font-medium tracking-wide text-muted">{t("other")}</h3>
          <ul className="flex flex-col gap-1">
            <li className="flex justify-between"><span>{t("payNowDiscount")}</span><span className="tabular-nums">{config.data.payNowDiscountBps / 100}%</span></li>
            <li className="flex justify-between"><span>{t("youngDriver")}</span><span className="tabular-nums">{formatMoney(config.data.youngDriver.feeDailyCents)} / {t("day")}</span></li>
            <li className="flex justify-between"><span>{t("delivery")}</span><span className="tabular-nums">{formatMoney(config.data.deliveryFeeCents)}</span></li>
            <li className="flex justify-between"><span>{t("lateFee")}</span><span className="tabular-nums">{formatMoney(config.data.lateReturn.notifiedFeeCents)} / {formatMoney(config.data.lateReturn.unannouncedFeeCents)}</span></li>
            <li className="flex justify-between"><span>{t("maxDays")}</span><span className="tabular-nums">{config.data.maxRentalDays}</span></li>
            <li className="flex justify-between"><span>{t("minLead")}</span><span className="tabular-nums">{config.data.minLeadHours} h</span></li>
          </ul>
        </div>
      </section>
    </>
  );
}
