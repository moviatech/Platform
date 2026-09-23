import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { currentTime } from "@/features/booking/time";
import { previewCancellationFee } from "@/features/payments/cancel-settlement";
import { listChangeRequests, pendingChangeStatuses } from "@/features/portal/change-queries";
import { getTrip } from "@/features/portal/queries";
import { startCheckout, startIdentity } from "@/features/portal/trip-actions";
import { CancelForm } from "@/features/portal/TripControls";
import { ensureTripSurvey } from "@/features/ratings/service";
import { statusTone } from "@/features/reservations/types";
import { requireCustomer } from "@/lib/auth/customer";
import { stripeConfigured } from "@/lib/stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatFullDateTime, formatMoney } from "@/lib/utils/format";

export const metadata: Metadata = { title: "Trip" };

type Props = { params: Promise<{ number: string }>; searchParams: Promise<{ identity?: string; error?: string }> };

const openStatuses = ["REQUESTED", "PENDING_PAYMENT", "CONFIRMED"];

function Step({ done, title, detail, children }: { done: boolean; title: string; detail?: string; children?: React.ReactNode }) {
  return (
    <li className="flex gap-3.5 py-4">
      <span className={`mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ${done ? "bg-status-available text-white" : "border border-ink/20 text-muted"}`}>{done ? "✓" : ""}</span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{title}</p>
        {detail && <p className="mt-0.5 text-[13px] text-muted">{detail}</p>}
        {!done && children && <div className="mt-2.5">{children}</div>}
      </div>
    </li>
  );
}

export default async function TripPage({ params, searchParams }: Props) {
  const session = await requireCustomer();
  const { number } = await params;
  const { identity, error } = await searchParams;
  if (!/^MV-[A-Z0-9]{6}$/.test(number)) notFound();
  const trip = await getTrip(session.customerId, number);
  if (!trip) notFound();

  const [t, statuses, reservations, locale, changeRequests] = await Promise.all([getTranslations("portal.trip"), getTranslations("reservations.status"), getTranslations("reservations"), getLocale(), listChangeRequests(trip.id, session.customerId)]);
  const pendingChanges = changeRequests.filter((request) => pendingChangeStatuses.includes(request.status)).length;
  const { data: card } = await createAdminClient().from("customers").select("stripe_payment_method_id, identity_status, identity_error").eq("id", session.customerId).single();
  const hasCard = Boolean(card?.stripe_payment_method_id);
  const identityStatus = card?.identity_status ?? "PENDING";

  const zh = locale === "zh";
  const className = zh ? (trip.vehicle_class?.name_zh ?? trip.vehicle_class?.name) : trip.vehicle_class?.name;
  const locationName = zh ? (trip.location?.name_zh ?? trip.location?.name) : trip.location?.name;
  const instructions = zh ? (trip.location?.pickup_instructions_zh ?? trip.location?.pickup_instructions) : trip.location?.pickup_instructions;
  const holdCents = trip.security_hold_cents + (trip.quote_snapshot?.depositCents ?? 0);
  const open = openStatuses.includes(trip.status);
  const survey = trip.status === "COMPLETED" ? await ensureTripSurvey(trip.id) : null;
  const cancellable = open && new Date(trip.pickup_at).getTime() > currentTime();
  const feeCents = cancellable
    ? await previewCancellationFee({ id: trip.id, rental_days: trip.rental_days, total_cents: trip.total_cents, pickup_at: trip.pickup_at, policy_snapshot: trip.policy_snapshot, quote_snapshot: trip.quote_snapshot, customer: null }, false)
    : 0;
  const paid = ["PAID", "PARTIALLY_REFUNDED"].includes(trip.payment_state);
  const paymentDone = trip.rate_plan === "PAY_NOW" ? paid : hasCard || paid;

  return (
    <>
      <Link href="/trips" className="mb-4 inline-block text-[13px] text-muted hover:text-ink">
        ← {t("back")}
      </Link>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="eyebrow">{trip.number}</p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight">{className}</h1>
        </div>
        <Badge tone={statusTone[trip.status]}>{statuses(trip.status)}</Badge>
      </div>

      {identity === "submitted" && <p className="mb-4 rounded-xl bg-status-info/10 px-4 py-3 text-sm">{t("identitySubmitted")}</p>}
      {error && (
        <p className="mb-4 rounded-xl bg-status-danger/8 px-4 py-3 text-sm text-status-danger" role="alert">
          {t.has(`errors.${error}`) ? t(`errors.${error}`) : t("errors.generic")}
        </p>
      )}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="flex min-w-0 flex-col gap-5">
          {open && (
            <section className="card px-6 py-2">
              <h2 className="pt-4 text-sm font-semibold">{t("checklist")}</h2>
              <ol className="divide-y divide-ink/[0.06]">
                <Step
                  done={paymentDone}
                  title={trip.rate_plan === "PAY_NOW" ? t("steps.pay") : t("steps.card")}
                  detail={paymentDone ? (paid ? t("steps.paid") : t("steps.cardSaved")) : trip.rate_plan === "PAY_NOW" ? t("steps.payDetail", { amount: formatMoney(trip.total_cents) }) : t("steps.cardDetail", { amount: formatMoney(trip.total_cents) })}
                >
                  {stripeConfigured() && (
                    <form action={startCheckout}>
                      <input type="hidden" name="number" value={trip.number} />
                      <Button type="submit" size="sm">
                        {trip.rate_plan === "PAY_NOW" ? t("steps.payNow") : t("steps.addCard")}
                      </Button>
                    </form>
                  )}
                </Step>
                <Step
                  done={identityStatus === "VERIFIED"}
                  title={t("steps.license")}
                  detail={
                    identityStatus === "VERIFIED"
                      ? t("steps.licenseVerified")
                      : identityStatus === "SUBMITTED"
                        ? t("steps.licensePending")
                        : identityStatus === "REJECTED"
                          ? t("steps.licenseRejected", { reason: card?.identity_error ?? "" })
                          : t("steps.licenseDetail")
                  }
                >
                  {identityStatus !== "SUBMITTED" && stripeConfigured() && (
                    <form action={startIdentity}>
                      <input type="hidden" name="number" value={trip.number} />
                      <Button type="submit" size="sm" variant="secondary">
                        {t("steps.verifyOnline")}
                      </Button>
                    </form>
                  )}
                </Step>
                <Step done={trip.agreement_state === "SIGNED"} title={t("steps.agreement")} detail={trip.agreement_state === "SIGNED" ? t("steps.agreementSigned") : t("steps.agreementDetail")}>
                  <Link href={`/trips/${trip.number}/agreement`} className="inline-flex h-9 items-center rounded-pill bg-white px-4 text-[13px] font-medium text-ink hairline hover:border-ink/25">
                    {t("steps.readAndSign")}
                  </Link>
                </Step>
                <Step done={trip.hold_state === "AUTHORIZED" || trip.hold_state === "CAPTURED"} title={t("steps.hold")} detail={t("steps.holdDetail", { amount: formatMoney(holdCents) })} />
              </ol>
              {trip.agreement_state === "SIGNED" && (
                <p className="pb-4 text-[13px]">
                  <Link href={`/trips/${trip.number}/agreement`} className="underline decoration-gold/50 underline-offset-4 hover:decoration-gold">
                    {t("viewAgreement")}
                  </Link>
                </p>
              )}
            </section>
          )}

          <section className="card p-6">
            <h2 className="text-sm font-semibold">{t("details")}</h2>
            <dl className="mt-2 divide-y divide-ink/[0.06] text-sm">
              {[
                [t("pickup"), formatFullDateTime(trip.pickup_at, locale)],
                [t("return"), formatFullDateTime(trip.return_at, locale)],
                [t("location"), `${locationName ?? ""}${trip.location?.address ? ` · ${trip.location.address}` : ""}`],
                ...(trip.pickup_method === "DELIVERY" ? [[t("delivery"), trip.delivery_address ?? "—"]] : []),
                ...(trip.vehicle && ["ACTIVE", "COMPLETED"].includes(trip.status) ? [[t("vehicle"), [trip.vehicle.fleet_number, trip.vehicle.exterior_color, trip.vehicle.license_plate].filter(Boolean).join(" · ")]] : []),
                [reservations("form.protection"), reservations(`protection.${trip.protection}`)],
                [reservations("form.addOns"), trip.add_ons.length ? trip.add_ons.map((item) => reservations(`addOn.${item}`)).join("、") : "—"],
              ].map(([label, value]) => (
                <div key={label} className="flex items-baseline justify-between gap-6 py-2.5">
                  <dt className="shrink-0 text-[13px] text-muted">{label}</dt>
                  <dd className="min-w-0 text-right break-words">{value}</dd>
                </div>
              ))}
            </dl>
            {instructions && <p className="mt-4 rounded-xl bg-pearl px-4 py-3 text-[13px] leading-relaxed text-charcoal">{instructions}</p>}
          </section>

          <section className="card p-6">
            <h2 className="text-sm font-semibold">{t("charges")}</h2>
            <dl className="mt-3 flex flex-col gap-1.5 text-[13px]">
              {trip.line_items.map((line) => (
                <div key={line.id} className="flex justify-between gap-4">
                  <dt className="text-charcoal">{reservations.has(`line.${line.code.replace(".", "_")}`) ? reservations(`line.${line.code.replace(".", "_")}`) : line.description}</dt>
                  <dd className="tabular-nums">{formatMoney(line.amount_cents)}</dd>
                </div>
              ))}
              <div className="mt-2 flex justify-between border-t border-ink/[0.08] pt-2.5 text-sm font-semibold">
                <dt>{t("total")}</dt>
                <dd className="tabular-nums">{formatMoney(trip.total_cents)}</dd>
              </div>
            </dl>
          </section>
        </div>

        <aside className="flex flex-col gap-5">
          <section className="card p-6 text-[13px]">
            <h2 className="text-sm font-semibold">{t("help")}</h2>
            <div className="mt-2 flex flex-wrap gap-2">
              {(open || trip.status === "ACTIVE") && (
                <>
                  <Link href={`/trips/${trip.number}/modify`} className="rounded-pill bg-white px-3.5 py-1.5 text-[13px] font-medium text-ink hairline hover:border-ink/25">
                    {t("changeDates")}
                    {pendingChanges > 0 ? ` · ${pendingChanges}` : ""}
                  </Link>
                  <Link href={`/trips/${trip.number}/modify?action=special`} className="rounded-pill bg-white px-3.5 py-1.5 text-[13px] font-medium text-ink hairline hover:border-ink/25">
                    {t("specialRequest")}
                  </Link>
                </>
              )}
              <Link href={`/messages?type=other${open || trip.status === "ACTIVE" ? `&trip=${trip.number}` : ""}`} className="rounded-pill bg-white px-3.5 py-1.5 text-[13px] font-medium text-ink hairline hover:border-ink/25">
                {t("contactUs")}
              </Link>
              {survey && (
                <Link href={`/survey/${survey.token}`} className="rounded-pill bg-gold px-3.5 py-1.5 text-[13px] font-medium text-white hover:bg-gold-light">
                  {survey.completed_at ? t("surveyDone") : t("rateTrip")}
                </Link>
              )}
            </div>
          </section>
          {cancellable && (
            <section className="card p-6">
              <h2 className="mb-3 text-sm font-semibold">{t("cancelTitle")}</h2>
              <CancelForm number={trip.number} feeCents={feeCents} />
            </section>
          )}
        </aside>
      </div>
    </>
  );
}
