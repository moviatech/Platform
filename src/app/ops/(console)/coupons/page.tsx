import type { Metadata } from "next";
import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/Badge";
import { PageHeader } from "@/components/ops/PageHeader";
import { zonedParts } from "@/features/booking/time";
import { CouponForm } from "@/features/coupons/CouponForm";
import { couponState } from "@/features/coupons/rules";
import { couponUsage, listCoupons } from "@/features/coupons/service";
import { can, requirePagePermission } from "@/lib/auth/staff";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatDate, formatMoney } from "@/lib/utils/format";

export const metadata: Metadata = { title: "Coupons" };

const tones = { live: "success", scheduled: "neutral", paused: "warning", ended: "neutral", used_up: "neutral" } as const;

export default async function CouponsPage() {
  const session = await requirePagePermission("pricing.view");
  const editable = can(session, "pricing.edit");
  const supabase = createAdminClient();
  const [t, reservations, locale, coupons, usage, { data: classRows }, { data: locationRows }] = await Promise.all([
    getTranslations("coupons"),
    getTranslations("reservations"),
    getLocale(),
    listCoupons(),
    couponUsage(),
    supabase.from("vehicle_classes").select("id, name, name_zh").eq("active", true).order("sort_order"),
    supabase.from("locations").select("id, name, name_zh").eq("active", true).order("name"),
  ]);
  const named = (rows: Array<{ id: string; name: string; name_zh: string | null }> | null) => (rows ?? []).map((row) => ({ id: row.id, name: locale === "zh" ? (row.name_zh ?? row.name) : row.name }));
  const classes = named(classRows);
  const locations = named(locationRows);
  const today = zonedParts(new Date(), "America/Los_Angeles").date;

  return (
    <>
      <PageHeader title={t("title")} />
      {editable && (
        <details className="card mb-6 p-5">
          <summary className="cursor-pointer text-sm font-semibold">{t("add")}</summary>
          <div className="mt-5">
            <CouponForm classes={classes} locations={locations} />
          </div>
        </details>
      )}
      {coupons.length === 0 ? (
        <p className="card px-5 py-12 text-center text-[13px] text-muted">{t("empty")}</p>
      ) : (
        <section className="card divide-y divide-ink/[0.06] overflow-hidden">
          {coupons.map((coupon) => {
            const used = usage.get(coupon.id) ?? { count: 0, discountCents: 0, orders: [] };
            const state = couponState(coupon, today, used.count);
            const value = coupon.kind === "PERCENT" ? `${coupon.percent_bps / 100}%` : formatMoney(coupon.amount_cents);
            return (
              <details key={coupon.id} className="group">
                <summary className="grid cursor-pointer grid-cols-2 items-center gap-x-4 gap-y-1 px-5 py-3.5 text-[13px] hover:bg-ink/[0.02] md:grid-cols-[minmax(0,1.4fr)_5rem_minmax(0,1.1fr)_6rem_7rem_minmax(0,1fr)_5.5rem]">
                  <span className="min-w-0">
                    <span className="font-mono text-sm font-semibold">{coupon.code}</span>
                    {coupon.label ? <span className="block truncate text-xs text-muted">{coupon.label}</span> : null}
                  </span>
                  <span className="font-semibold tabular-nums">−{value}</span>
                  <span className="text-muted">{coupon.valid_from || coupon.valid_to ? `${coupon.valid_from ?? "…"} → ${coupon.valid_to ?? "…"}` : t("always")}</span>
                  <span className="tabular-nums">
                    {used.count}
                    {coupon.max_redemptions !== null ? ` / ${coupon.max_redemptions}` : ""}
                  </span>
                  <span className="tabular-nums text-muted">{used.discountCents > 0 ? `−${formatMoney(used.discountCents)}` : "—"}</span>
                  <span className="text-muted">
                    {t(`bearers.${coupon.bearer}`)}
                    {coupon.stackable ? ` · ${t("stacks")}` : ""}
                  </span>
                  <span className="justify-self-start md:justify-self-end">
                    <Badge tone={tones[state]}>{t(`state.${state}`)}</Badge>
                  </span>
                </summary>
                <div className="flex flex-col gap-5 border-t border-ink/[0.06] bg-pearl/40 px-5 py-5">
                  {editable && <CouponForm coupon={coupon} classes={classes} locations={locations} />}
                  {used.orders.length > 0 && (
                    <ul className="flex flex-col gap-1.5 text-[13px]">
                      {used.orders.map((order) => (
                        <li key={order.id} className="flex flex-wrap items-center justify-between gap-3">
                          <Link href={`/reservations/${order.id}`} className="font-medium hover:text-gold">
                            {order.number}
                            <span className="font-normal text-muted"> · {order.customer?.full_name ?? ""} · {formatDate(order.pickup_at)}</span>
                          </Link>
                          <span className="flex items-center gap-3">
                            <span className="text-xs text-muted">{reservations(`status.${order.status}`)}</span>
                            <span className="tabular-nums">−{formatMoney(order.discountCents)}</span>
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </details>
            );
          })}
        </section>
      )}
    </>
  );
}
