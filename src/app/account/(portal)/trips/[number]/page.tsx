import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/Badge";
import { Button, ButtonLink } from "@/components/ui/Button";
import { currentTime } from "@/features/booking/time";
import { previewCancellationFee } from "@/features/payments/cancel-settlement";
import { prepayPreview } from "@/features/payments/prepay";
import { paidRentalCents } from "@/features/payments/service";
import { listChangeRequests, pendingChangeStatuses } from "@/features/portal/change-queries";
import { getTrip } from "@/features/portal/queries";
import { startIdentity } from "@/features/portal/trip-actions";
import { CancelForm } from "@/features/portal/TripControls";
import { DamageConsent } from "@/features/portal/DamageConsent";
import { SelfServiceCard } from "@/features/selfservice/SelfServiceCard";
import { canStartSelfPickup, checklistFor, loadSelfService } from "@/features/selfservice/service";
import { startWindowMinutes } from "@/features/selfservice/types";
import { listClaims } from "@/features/claims/service";
import { ensureTripSurvey } from "@/features/ratings/service";
import { statusTone } from "@/features/reservations/types";
import { requireCustomer } from "@/lib/auth/customer";
import { stripeConfigured } from "@/lib/stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatFullDateTime, formatMoney } from "@/lib/utils/format";

export const metadata: Metadata = { title: "Trip" };

type Props = { params: Promise<{ number: string }>; searchParams: Promise<{ identity?: string; error?: string; paid?: string; card?: string }> };

const openStatuses = ["REQUESTED", "PENDING_PAYMENT", "CONFIRMED"];

function Step({ done, title, detail, action, children }: { done: boolean; title: string; detail?: string; action?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <li className="flex gap-3.5 py-4">
      <span className={`mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ${done ? "bg-status-available text-white" : "border border-ink/20 text-muted"}`}>{done ? "✓" : ""}</span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{title}</p>
        {detail && <p className="mt-0.5 text-[13px] text-muted">{detail}</p>}
        {action && <div className="mt-1.5">{action}</div>}
        {!done && children && <div className="mt-2.5">{children}</div>}
      </div>
    </li>
  );
}

export default async function TripPage({ params, searchParams }: Props) {
  const session = await requireCustomer();
  const { number } = await params;
  const { identity, error, paid: paidNotice, card: cardNotice } = await searchParams;
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
  const paidCents = await paidRentalCents(trip.id);
  const dueCents = trip.total_cents - paidCents;
  const prepayOffer = stripeConfigured() && open && trip.rate_plan === "PAY_LATER" && paidCents === 0 && new Date(trip.pickup_at).getTime() > currentTime() ? await prepayPreview(trip.id) : null;
  const claims = trip.status === "COMPLETED" ? (await listClaims(trip.id)).filter((claim) => claim.customer_id === session.customerId) : [];
  const selfService = trip.pickup_method === "SELF_SERVICE" && ["REQUESTED", "PENDING_PAYMENT", "CONFIRMED", "ACTIVE"].includes(trip.status) ? await loadSelfService(trip.id) : null;
  const paymentDone = paidCents > 0 ? dueCents <= 0 : trip.rate_plan === "PAY_LATER" && hasCard;

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
      {paidNotice === "1" && <p className="mb-4 rounded-xl bg-status-available/10 px-4 py-3 text-sm">{t("paidNotice")}</p>}
      {cardNotice === "saved" && <p className="mb-4 rounded-xl bg-status-available/10 px-4 py-3 text-sm">{t("cardNotice")}</p>}
      {error && (
        <p className="mb-4 rounded-xl bg-status-danger/8 px-4 py-3 text-sm text-status-danger" role="alert">
          {t.has(`errors.${error}`) ? t(`errors.${error}`) : t("errors.generic")}
        </p>
      )}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="flex min-w-0 flex-col gap-5">
          {selfService && selfService.self_service_state !== "NONE" && (
            <section className="card p-6">
              <h2 className="mb-3 text-sm font-semibold">{t("selfService.title")}</h2>
              <SelfServiceCard
                number={trip.number}
                state={selfService.self_service_state}
                status={trip.status}
                checklist={checklistFor(selfService)}
                canStart={canStartSelfPickup(selfService, currentTime())}
                windowOpen={currentTime() >= new Date(selfService.pickup_at).getTime() - startWindowMinutes * 60000}
                accessLink={selfService.self_service_state === "STARTED" ? selfService.access_link : null}
                accessNote={selfService.self_service_state === "STARTED" ? selfService.access_note : null}
                note={selfService.self_service_note}
              />
            </section>
          )}
          {claims.map((claim) => (
            <section key={claim.id} className="card p-6">
              <h2 className="mb-3 text-sm font-semibold">{t("damage.title")}</h2>
              {claim.status === "PENDING_CONSENT" ? (
                <DamageConsent claimId={claim.id} number={trip.number} amountCents={claim.amount_cents} description={claim.description} />
              ) : (
                <p className="text-sm text-charcoal">{t(`damage.state.${claim.status}`, { amount: formatMoney(claim.amount_cents) })}</p>
              )}
            </section>
          ))}
          {open && (
            <section className="card px-6 py-2">
              <h2 className="pt-4 text-sm font-semibold">{t("checklist")}</h2>
              <ol className="divide-y divide-ink/[0.06]">
                <Step
                  done={paymentDone}
                  title={trip.rate_plan === "PAY_NOW" || paidCents > 0 ? t("steps.pay") : t("steps.card")}
                  detail={
                    paymentDone
                      ? paidCents > 0
                        ? t("steps.paid")
                        : t("steps.cardSaved")
                      : paidCents > 0
                        ? t("steps.balanceDue", { amount: formatMoney(dueCents) })
                        : trip.rate_plan === "PAY_NOW"
                          ? t("steps.payDetail", { amount: formatMoney(trip.total_cents) })
                          : t("steps.cardDetail", { amount: formatMoney(trip.total_cents) })
                  }
                  action={
                    prepayOffer && prepayOffer.discountCents > 0 ? (
                      <Link href={`/trips/${trip.number}/pay?mode=prepay`} className="text-[13px] font-medium text-gold hover:text-gold-light">
                        {t("steps.prepay", { percent: prepayOffer.percent, amount: formatMoney(prepayOffer.totalCents) })} →
                      </Link>
                    ) : undefined
                  }
                >
                  {stripeConfigured() && !paymentDone && (
                    <ButtonLink href={`/trips/${trip.number}/pay`} size="sm">
                      {trip.rate_plan === "PAY_NOW" || paidCents > 0 ? t("steps.payNow") : t("steps.addCard")}
                    </ButtonLink>
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

          <div className="grid gap-5 xl:grid-cols-2">
          <section className="card p-6">
            <h2 className="text-sm font-semibold">{t("details")}</h2>
            <dl className="mt-2 divide-y divide-ink/[0.06] text-sm">
              {[
                [t("pickup"), formatFullDateTime(trip.pickup_at)],
                [t("return"), formatFullDateTime(trip.return_at)],
                ...(trip.pickup_method === "SELF_SERVICE" && trip.delivery_address ? [] : [[t("location"), `${locationName ?? ""}${trip.location?.address ? ` · ${trip.location.address}` : ""}`]]),
                ...(trip.pickup_method === "DELIVERY" ? [[t("delivery"), trip.delivery_address ?? "—"]] : []),
                ...(trip.pickup_method === "SELF_SERVICE" && trip.delivery_address ? [[t("selfService.location"), trip.delivery_address]] : []),
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
        </div>

        <aside className="flex flex-col gap-5">
          <section className="card p-6 text-[13px]">
            <h2 className="text-sm font-semibold">{t("help")}</h2>
            <div className="mt-2 flex flex-wrap gap-2">
              {(open || trip.status === "ACTIVE") && (
                <>
                  <Link href={`/trips/${trip.number}/modify`} className="rounded-pill bg-white px-3.5 py-1.5 text-[13px] font-medium text-ink hairline hover:border-ink/25">
                    {t("changeDates")}
                    {pendingChanges > 0 ? ` · ${t("pendingBadge", { count: pendingChanges })}` : ""}
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
