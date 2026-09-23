import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/Badge";
import { BackLink, withBack } from "@/components/ops/BackLink";
import { PageHeader } from "@/components/ops/PageHeader";
import { PickupForm } from "@/features/handover/HandoverForms";
import { listSpecialRequests } from "@/features/handover/queries";
import { getReservation } from "@/features/reservations/queries";
import { r2Configured } from "@/lib/media/r2";
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

  const [t, r, types] = await Promise.all([getTranslations("handover"), getTranslations("reservations"), getTranslations("portal.help.types")]);
  const requests = await listSpecialRequests(id, { childSeat: t("installChildSeat"), kind: (kind) => (types.has(kind) ? types(kind) : kind) });
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

  const gates: Array<{ step: number; label: string; value: string; ok: boolean; href?: string; hrefLabel?: string }> = [
    { step: 1, label: t("vehicle"), value: vehicle ? [vehicle.fleet_number, vehicle.license_plate, vehicle.vin].filter(Boolean).join(" · ") : "—", ok: Boolean(vehicle) },
    { step: 1, label: t("license"), value: r(`state.${reservation.verification_state}`), ok: reservation.verification_state === "VERIFIED" },
    {
      step: 2,
      label: t("agreement"),
      value: r(`state.${reservation.agreement_state}`),
      ok: signed,
      href: signed ? withBack(`/reservations/${id}/agreement`, `/reservations/${id}/pickup`) : `/reservations/${id}/sign`,
      hrefLabel: signed ? t("viewAgreement") : t("signHere"),
    },
    { step: 3, label: t("payment"), value: reservation.payment_state === "PAID" ? r("state.PAID") : customer?.stripe_payment_method_id ? t("cardOnFile") : r(`state.${reservation.payment_state}`), ok: paymentOk },
    { step: 3, label: t("hold"), value: reservation.hold_state === "AUTHORIZED" ? r("state.AUTHORIZED") : t("autoHold", { amount: formatMoney(holdCents) }), ok: reservation.hold_state === "AUTHORIZED" },
  ];
  const stepTitles: Record<number, string> = { 1: t("stepVerify"), 2: t("stepAgreement"), 3: t("stepPayment") };

  return (
    <>
      <BackLink href={`/reservations/${id}`} />
      <PageHeader eyebrow={reservation.number} title={t("pickup")} lead={`${reservation.customer?.full_name ?? ""} · ${formatFullDateTime(reservation.pickup_at)}`} />
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <section className="card p-6">
          <h2 className="mb-3 text-sm font-semibold">{t("gates")}</h2>
          <dl className="flex flex-col gap-2.5">
            {gates.map((gate, index) => (
              <div key={gate.label} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 text-[13px]">
                {(index === 0 || gates[index - 1].step !== gate.step) && (
                  <p className="flex w-full items-center gap-2 pt-2 text-xs font-medium tracking-wide text-charcoal">
                    <span className="flex size-5 items-center justify-center rounded-full bg-ink text-[11px] text-white">{gate.step}</span>
                    {stepTitles[gate.step]}
                  </p>
                )}
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
            requests={requests}
            videoEnabled={r2Configured()}
          />
        </section>
      </div>
    </>
  );
}
