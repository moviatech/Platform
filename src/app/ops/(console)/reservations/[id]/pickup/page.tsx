import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/Badge";
import { BackLink, withBack } from "@/components/ops/BackLink";
import { PageHeader } from "@/components/ops/PageHeader";
import { PickupForm } from "@/features/handover/HandoverForms";
import { getReservation } from "@/features/reservations/queries";
import { requirePagePermission } from "@/lib/auth/staff";
import { createClient } from "@/lib/supabase/server";
import { formatFullDateTime, formatMoney } from "@/lib/utils/format";

export const metadata: Metadata = { title: "Pickup" };

type Props = { params: Promise<{ id: string }> };

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function PickupPage({ params }: Props) {
  const staff = await requirePagePermission("vehicle.inspect");
  const { id } = await params;
  if (!uuid.test(id)) notFound();
  const reservation = await getReservation(id);
  if (!reservation) notFound();
  if (reservation.status !== "CONFIRMED") redirect(`/reservations/${id}`);

  const [t, r, locale] = await Promise.all([getTranslations("handover"), getTranslations("reservations"), getLocale()]);
  const supabase = await createClient();
  const [{ data: vehicle }, { data: customer }] = await Promise.all([
    reservation.assigned_vehicle_id
      ? supabase.from("vehicles").select("fleet_number, vin, license_plate, odometer, battery_level").eq("id", reservation.assigned_vehicle_id).maybeSingle()
      : Promise.resolve({ data: null }),
    reservation.customer ? supabase.from("customers").select("stripe_payment_method_id").eq("id", reservation.customer.id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const holdCents = reservation.security_hold_cents + (reservation.quote_snapshot?.depositCents ?? 0);
  const signed = reservation.agreement_state === "SIGNED";
  const paymentOk = reservation.payment_state === "PAID" || Boolean(customer?.stripe_payment_method_id);

  const gates: Array<{ label: string; value: string; ok: boolean; href?: string; hrefLabel?: string }> = [
    { label: t("vehicle"), value: vehicle ? [vehicle.fleet_number, vehicle.license_plate, vehicle.vin].filter(Boolean).join(" · ") : "—", ok: Boolean(vehicle) },
    { label: t("payment"), value: reservation.payment_state === "PAID" ? r("state.PAID") : customer?.stripe_payment_method_id ? t("cardOnFile") : r(`state.${reservation.payment_state}`), ok: paymentOk },
    { label: t("license"), value: r(`state.${reservation.verification_state}`), ok: reservation.verification_state === "VERIFIED" },
    {
      label: t("agreement"),
      value: r(`state.${reservation.agreement_state}`),
      ok: signed,
      href: signed ? withBack(`/reservations/${id}/agreement`, `/reservations/${id}/pickup`) : `/reservations/${id}/sign`,
      hrefLabel: signed ? t("viewAgreement") : t("signHere"),
    },
    { label: t("hold"), value: reservation.hold_state === "AUTHORIZED" ? r("state.AUTHORIZED") : t("autoHold", { amount: formatMoney(holdCents) }), ok: reservation.hold_state === "AUTHORIZED" },
  ];

  return (
    <>
      <BackLink href={`/reservations/${id}`} />
      <PageHeader eyebrow={reservation.number} title={t("pickup")} lead={`${reservation.customer?.full_name ?? ""} · ${formatFullDateTime(reservation.pickup_at, locale)}`} />
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <section className="card p-6">
          <h2 className="mb-3 text-sm font-semibold">{t("gates")}</h2>
          <dl className="flex flex-col gap-2.5">
            {gates.map((gate) => (
              <div key={gate.label} className="flex items-center justify-between gap-4 text-[13px]">
                <dt className="text-charcoal">
                  {gate.label}
                  {gate.href && (
                    <Link href={gate.href} className="ml-2 text-[11px] text-charcoal underline decoration-gold/50 underline-offset-2 hover:decoration-gold">
                      {gate.hrefLabel}
                    </Link>
                  )}
                </dt>
                <dd className="flex items-center gap-2 text-right">
                  <span className="text-muted">{gate.value}</span>
                  <Badge tone={gate.ok ? "success" : "warning"}>{gate.ok ? "✓" : "…"}</Badge>
                </dd>
              </div>
            ))}
          </dl>
        </section>
        <section className="card p-6">
          <PickupForm
            reservationId={id}
            licenseVerified={reservation.verification_state === "VERIFIED"}
            hasExtraDriver={reservation.add_ons.includes("driver")}
            hasChildSeat={reservation.add_ons.includes("childSeat")}
            odometer={vehicle?.odometer ?? null}
            battery={vehicle?.battery_level ?? null}
            canOverride={staff.permissions.has("handover.override")}
          />
        </section>
      </div>
    </>
  );
}
