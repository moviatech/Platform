import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/Badge";
import { ButtonLink } from "@/components/ui/Button";
import { BackLink, safeBack, withBack } from "@/components/ops/BackLink";
import { PageHeader } from "@/components/ops/PageHeader";
import { currentTime } from "@/features/booking/time";
import { InspectionSummary } from "@/features/handover/InspectionSummary";
import { listChangeRequests, pendingChangeStatuses } from "@/features/portal/change-queries";
import { currentChangeInput, loadEditableReservation, previewChange } from "@/features/reservations/apply-change";
import { ChangeRequestPanel, type ChangeRequestView } from "@/features/reservations/ChangeRequestPanel";
import { BookingError } from "@/features/booking/service";
import { zonedParts } from "@/features/booking/time";
import { listInspections } from "@/features/handover/queries";
import { listEntityAudit } from "@/features/leads/queries";
import { previewCancellationFee } from "@/features/payments/cancel-settlement";
import { PaymentsPanel, type PaymentRow } from "@/features/payments/PaymentsPanel";
import { listAssignableVehicles } from "@/features/reservations/actions";
import { AdjustmentForm } from "@/features/reservations/AdjustmentForm";
import { AssignVehicleForm, DeliveryFeeForm, NotesForm, ReadinessControls, StatusActions } from "@/features/reservations/DetailControls";
import { getReservation } from "@/features/reservations/queries";
import { reservationStatuses, statusTone, undoWindowMs, type ReservationStatus } from "@/features/reservations/types";
import { can, requirePagePermission } from "@/lib/auth/staff";
import { stripeConfigured } from "@/lib/stripe";
import { createClient } from "@/lib/supabase/server";
import { formatFullDateTime, formatMoney } from "@/lib/utils/format";

export const metadata: Metadata = { title: "Reservation" };

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ back?: string }> };

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function ReservationPage({ params, searchParams }: Props) {
  const session = await requirePagePermission("reservation.view");
  const { id } = await params;
  const { back } = await searchParams;
  if (!uuid.test(id)) notFound();
  const reservation = await getReservation(id);
  if (!reservation) notFound();

  const assignable = ["REQUESTED", "PENDING_PAYMENT", "CONFIRMED"].includes(reservation.status) && can(session, "reservation.assign_vehicle");
  const [t, h, locale, activity, options, inspections, changeRequests] = await Promise.all([
    getTranslations("reservations"),
    getTranslations("handover"),
    getLocale(),
    listEntityAudit("reservation", id),
    assignable ? listAssignableVehicles(id) : Promise.resolve([]),
    listInspections(id),
    listChangeRequests(id),
  ]);
  const editableRow = changeRequests.some((request) => pendingChangeStatuses.includes(request.status)) ? await loadEditableReservation(id) : null;
  const changeViews: ChangeRequestView[] = await Promise.all(
    changeRequests.map(async (request) => {
      const pending = pendingChangeStatuses.includes(request.status);
      const lines: string[] = [];
      const zh = locale === "zh";
      if (request.payload.pickupAt && request.payload.returnAt) lines.push(`${zh ? "希望改为" : "Requested"}: ${formatFullDateTime(request.payload.pickupAt, locale)} → ${formatFullDateTime(request.payload.returnAt, locale)}`);
      if (request.payload.driverName) lines.push(`${zh ? "驾驶人" : "Driver"}: ${request.payload.driverName}`);
      if (request.payload.notes) lines.push(request.payload.notes);
      let preview: ChangeRequestView["preview"] = null;
      if (pending && editableRow && request.payload.pickupAt && request.payload.returnAt) {
        const zone = "America/Los_Angeles";
        const pickup = zonedParts(request.payload.pickupAt, zone);
        const dropoff = zonedParts(request.payload.returnAt, zone);
        try {
          const result = await previewChange(editableRow, currentChangeInput(editableRow, { pickupDate: pickup.date, pickupTime: pickup.time, returnDate: dropoff.date, returnTime: dropoff.time }));
          const suggestedFeeCents = await previewCancellationFee({ id, rental_days: reservation.rental_days, total_cents: reservation.total_cents, pickup_at: reservation.pickup_at, policy_snapshot: reservation.policy_snapshot, quote_snapshot: reservation.quote_snapshot, customer: null }, false);
          preview = { available: result.available, newTotalCents: result.quote.totalCents, differenceCents: result.quote.totalCents - reservation.total_cents, suggestedFeeCents };
        } catch (cause) {
          preview = { available: 0, newTotalCents: reservation.total_cents, differenceCents: 0, suggestedFeeCents: 0, error: cause instanceof BookingError ? cause.code : "failed" };
        }
      }
      return { id: request.id, kind: request.kind, status: request.status, createdAt: formatFullDateTime(request.created_at, locale), lines, pending, preview, staffNote: request.staff_note, feeCents: request.fee_cents };
    }),
  );
  const handover = can(session, "vehicle.inspect") ? (reservation.status === "CONFIRMED" ? { href: `/reservations/${id}/pickup`, label: h("pickup") } : reservation.status === "ACTIVE" ? { href: `/reservations/${id}/return`, label: h("return") } : null) : null;
  const adjustmentLines = reservation.line_items.filter((line) => line.code.startsWith("manual."));
  const postRentalLines = reservation.line_items.filter((line) => line.type === "ADDITIONAL" && !line.code.startsWith("manual."));
  const bookingLines = reservation.line_items.filter((line) => !adjustmentLines.includes(line) && !postRentalLines.includes(line));
  const editableOrder = ["REQUESTED", "PENDING_PAYMENT", "CONFIRMED"].includes(reservation.status) && can(session, "reservation.edit");
  const lineLabel = (line: (typeof reservation.line_items)[number]) => (t.has(`line.${line.code.replace(".", "_")}`) ? t(`line.${line.code.replace(".", "_")}`) : line.description);

  const supabase = await createClient();
  const showPayments = can(session, "payment.view");
  const [{ data: paymentRows }, { data: card }] = await Promise.all([
    showPayments
      ? supabase
          .from("payments")
          .select("id, kind, status, amount_cents, amount_captured_cents, amount_refunded_cents, description, checkout_url, failure_message, created_at")
          .eq("reservation_id", id)
          .order("created_at")
      : Promise.resolve({ data: [] }),
    showPayments && reservation.customer ? supabase.from("customers").select("stripe_payment_method_id").eq("id", reservation.customer.id).maybeSingle() : Promise.resolve({ data: null }),
  ]);

  const paidCents = (paymentRows ?? []).filter((row) => ["RENTAL", "ADDITIONAL"].includes(row.kind)).reduce((sum, row) => sum + row.amount_captured_cents - row.amount_refunded_cents, 0);
  const dueCents = reservation.total_cents + postRentalLines.reduce((sum, line) => sum + line.amount_cents, 0) - paidCents;
  const settled = ["CANCELLED", "NO_SHOW"].includes(reservation.status) ? activity.find((event) => event.action === "reservation.cancellation_settled" || event.action === "reservation.no_show_settled") : null;
  const settlement = settled ? (settled.metadata as { feeCents?: number; refundedCents?: number; chargedCents?: number; uncollectedCents?: number; error?: string }) : null;
  const lastStatusEvent = activity.find((event) => event.action === "reservation.status_changed" || event.action === "reservation.status_reverted");
  const undoFrom = lastStatusEvent?.metadata.from;
  const undo =
    lastStatusEvent?.action === "reservation.status_changed" &&
    lastStatusEvent.actor_user_id &&
    typeof undoFrom === "string" &&
    (reservationStatuses as readonly string[]).includes(undoFrom) &&
    lastStatusEvent.metadata.to === reservation.status &&
    !["ACTIVE", "COMPLETED"].includes(reservation.status) &&
    currentTime() - new Date(lastStatusEvent.created_at).getTime() <= undoWindowMs
      ? { from: undoFrom as ReservationStatus }
      : null;

  const feeInput = { id, rental_days: reservation.rental_days, total_cents: reservation.total_cents, pickup_at: reservation.pickup_at, policy_snapshot: reservation.policy_snapshot, quote_snapshot: reservation.quote_snapshot, customer: null };
  const fees = { cancel: await previewCancellationFee(feeInput, false), noShow: await previewCancellationFee(feeInput, true) };

  const here = `/reservations/${id}`;
  const className = locale === "zh" ? (reservation.vehicle_class?.name_zh ?? reservation.vehicle_class?.name) : reservation.vehicle_class?.name;
  const facts: Array<[string, string]> = [
    [t("detail.class"), className ?? "—"],
    [t("form.pickup"), formatFullDateTime(reservation.pickup_at, locale)],
    [t("form.return"), formatFullDateTime(reservation.return_at, locale)],
    [t("columns.days"), String(reservation.rental_days)],
    [t("form.ratePlan"), t(`ratePlan.${reservation.rate_plan}`)],
    [t("form.protection"), t(`protection.${reservation.protection}`)],
    [t("form.addOns"), reservation.add_ons.length ? reservation.add_ons.map((item) => t(`addOn.${item}`)).join("、") : "—"],
    [t("form.ageBand"), t(`ageBand.${reservation.driver_age_band}`)],
    [t("form.pickupMethod"), `${t(`pickupMethod.${reservation.pickup_method}`)}${reservation.delivery_address ? ` · ${reservation.delivery_address}` : ""}`],
    [t("form.source"), t(`source.${reservation.booking_source}`)],
  ];
  if (reservation.expires_at && ["REQUESTED", "PENDING_PAYMENT"].includes(reservation.status)) facts.push([t("detail.expires"), formatFullDateTime(reservation.expires_at, locale)]);
  if (reservation.actual_pickup_at) facts.push([t("detail.actualPickup"), formatFullDateTime(reservation.actual_pickup_at, locale)]);
  if (reservation.actual_return_at) facts.push([t("detail.actualReturn"), formatFullDateTime(reservation.actual_return_at, locale)]);
  if (reservation.cancel_reason) facts.push([t("detail.reason"), reservation.cancel_reason]);

  return (
    <>
      <BackLink href={safeBack(back, "/reservations")} />
      <PageHeader
        eyebrow={className ?? undefined}
        title={reservation.number}
        lead={`${t("detail.created")} ${formatFullDateTime(reservation.created_at, locale)}`}
        actions={<Badge tone={statusTone[reservation.status]}>{t(`status.${reservation.status}`)}</Badge>}
      />
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_23rem]">
        <div className="flex min-w-0 flex-col gap-5">
          <section className="card p-6">
            <h2 className="text-sm font-semibold">{t("form.trip")}</h2>
            <dl className="mt-2 divide-y divide-ink/[0.06]">
              {facts.map(([label, value]) => (
                <div key={label} className="flex items-baseline justify-between gap-6 py-2.5">
                  <dt className="shrink-0 text-[13px] text-muted">{label}</dt>
                  <dd className="min-w-0 text-right text-sm break-words">{value}</dd>
                </div>
              ))}
            </dl>
            {reservation.customer_notes && <p className="mt-3 rounded-xl bg-pearl px-3.5 py-2.5 text-[13px] whitespace-pre-wrap text-charcoal">{reservation.customer_notes}</p>}
          </section>

          <section className="card p-6">
            <h2 className="text-sm font-semibold">{t("detail.charges")}</h2>
            <dl className="mt-3 flex flex-col gap-1.5 text-[13px]">
              {bookingLines.map((line) => (
                <div key={line.id} className="flex justify-between gap-4">
                  <dt className="text-charcoal">
                    {lineLabel(line)}
                    {Number(line.quantity) > 1 && line.unit_cents > 0 ? (
                      <span className="text-muted">
                        {" "}
                        · {Number(line.quantity)} × {formatMoney(line.unit_cents)}
                      </span>
                    ) : null}
                  </dt>
                  <dd className="tabular-nums">{formatMoney(line.amount_cents)}</dd>
                </div>
              ))}
              {adjustmentLines.map((line) => (
                <div key={line.id} className="flex justify-between gap-4">
                  <dt className="text-charcoal">{line.description}</dt>
                  <dd className="tabular-nums">{formatMoney(line.amount_cents)}</dd>
                </div>
              ))}
              <div className="mt-2 flex justify-between border-t border-ink/[0.08] pt-2.5 text-sm font-semibold">
                <dt>{t("form.total")}</dt>
                <dd className="tabular-nums">{formatMoney(reservation.total_cents)}</dd>
              </div>
              <div className="flex justify-between text-xs text-muted">
                <dt>{t("form.hold")}</dt>
                <dd className="tabular-nums">{formatMoney(reservation.security_hold_cents + (reservation.quote_snapshot?.depositCents ?? 0))}</dd>
              </div>
              {postRentalLines.length > 0 && (
                <>
                  <dt className="mt-3 border-t border-ink/[0.08] pt-2.5 text-xs font-medium tracking-wide text-charcoal">{h("additional")}</dt>
                  {postRentalLines.map((line) => (
                    <div key={line.id} className="flex justify-between gap-4">
                      <dt className="text-charcoal">
                        {lineLabel(line)}
                        {Number(line.quantity) > 1 ? (
                          <span className="text-muted">
                            {" "}
                            · {Number(line.quantity)} × {formatMoney(line.unit_cents)}
                          </span>
                        ) : null}
                      </dt>
                      <dd className="tabular-nums">{formatMoney(line.amount_cents)}</dd>
                    </div>
                  ))}
                  <div className="flex justify-between border-t border-ink/[0.08] pt-2 text-sm font-semibold">
                    <dt>{h("total")}</dt>
                    <dd className="tabular-nums">{formatMoney(postRentalLines.reduce((sum, line) => sum + line.amount_cents, 0))}</dd>
                  </div>
                </>
              )}
            </dl>
            {(adjustmentLines.length > 0 || (can(session, "reservation.edit") && !["CANCELLED", "NO_SHOW", "EXPIRED"].includes(reservation.status))) && (
              <AdjustmentForm reservationId={id} adjustments={adjustmentLines} editable={can(session, "reservation.edit") && !["CANCELLED", "NO_SHOW", "EXPIRED"].includes(reservation.status)} />
            )}
            {reservation.pickup_method === "DELIVERY" && (
              <DeliveryFeeForm
                reservationId={id}
                currentCents={reservation.line_items.find((line) => line.type === "DELIVERY")?.amount_cents ?? 0}
                editable={can(session, "reservation.edit") && ["REQUESTED", "PENDING_PAYMENT", "CONFIRMED"].includes(reservation.status)}
              />
            )}
          </section>

          {showPayments && (
            <section className="card p-6">
              <div className="mb-3 flex items-center justify-between gap-3">
                <h2 className="text-sm font-semibold">{t("detail.payments")}</h2>
                {!["CANCELLED", "NO_SHOW", "EXPIRED"].includes(reservation.status) && (
                  <Badge tone={dueCents > 0 ? "warning" : dueCents < 0 ? "info" : "success"}>
                    {dueCents > 0 ? t("edit.due", { amount: formatMoney(dueCents) }) : dueCents < 0 ? t("edit.refundDue", { amount: formatMoney(-dueCents) }) : t("edit.settled")}
                  </Badge>
                )}
              </div>
              <PaymentsPanel
                reservationId={id}
                payments={(paymentRows ?? []) as PaymentRow[]}
                hasSavedCard={Boolean(card?.stripe_payment_method_id)}
                closed={["CANCELLED", "EXPIRED"].includes(reservation.status)}
                canCapture={can(session, "payment.capture")}
                canRefund={can(session, "payment.refund")}
                stripeReady={stripeConfigured()}
                holdCents={reservation.security_hold_cents + (reservation.quote_snapshot?.depositCents ?? 0)}
              />
            </section>
          )}

          {changeViews.length > 0 && (
            <section className="card p-6">
              <h2 className="mb-3 text-sm font-semibold">{t("changeRequests.title")}</h2>
              <ChangeRequestPanel requests={changeViews} />
            </section>
          )}

          <InspectionSummary records={inspections} />

          <section className="card p-6">
            <h2 className="mb-3 text-sm font-semibold">{t("detail.internalNotes")}</h2>
            <NotesForm reservationId={id} notes={reservation.internal_notes} editable={can(session, "reservation.edit")} />
          </section>
        </div>

        <div className="flex flex-col gap-5">
          {settlement && (
            <section className="card p-6">
              <h2 className="mb-3 text-sm font-semibold">{reservation.status === "NO_SHOW" ? t("detail.noShowSettlement") : t("detail.cancelSettlement")}</h2>
              <dl className="flex flex-col gap-1.5 text-[13px]">
                <div className="flex justify-between gap-4"><dt className="text-muted">{t("detail.fee")}</dt><dd className="tabular-nums">{formatMoney(settlement.feeCents ?? 0)}</dd></div>
                <div className="flex justify-between gap-4"><dt className="text-muted">{t("detail.refunded")}</dt><dd className="tabular-nums">{formatMoney(settlement.refundedCents ?? 0)}</dd></div>
                <div className="flex justify-between gap-4"><dt className="text-muted">{t("detail.charged")}</dt><dd className="tabular-nums">{formatMoney(settlement.chargedCents ?? 0)}</dd></div>
                {(settlement.uncollectedCents ?? 0) > 0 && <div className="flex justify-between gap-4 text-status-danger"><dt>{t("detail.uncollectedLabel")}</dt><dd className="tabular-nums">{formatMoney(settlement.uncollectedCents ?? 0)}</dd></div>}
                {settlement.error && <p className="text-status-danger">{t.has(`errors.${settlement.error}`) ? t(`errors.${settlement.error}`) : settlement.error}</p>}
              </dl>
            </section>
          )}

          <section className="card p-6">
            <h2 className="mb-3 text-sm font-semibold">{t("detail.actions")}</h2>
            {(handover || editableOrder) && (
              <div className="mb-4 flex flex-wrap gap-2">
                {handover && (
                  <ButtonLink href={handover.href} size="md">
                    {handover.label}
                  </ButtonLink>
                )}
                {editableOrder && (
                  <ButtonLink href={`/reservations/${id}/edit`} size="md" variant="secondary">
                    {t("edit.open")}
                  </ButtonLink>
                )}
              </div>
            )}
            <StatusActions reservationId={id} status={reservation.status} canEdit={can(session, "reservation.edit")} canCancel={can(session, "reservation.cancel")} undo={undo} fees={fees} />
          </section>

          <section className="card p-6">
            <h2 className="text-sm font-semibold">{t("detail.vehicle")}</h2>
            <p className="mt-2 text-sm">
              {reservation.vehicle ? (
                <Link href={withBack(`/fleet/${reservation.vehicle.id}`, here)} className="font-semibold underline decoration-gold/50 underline-offset-4 hover:decoration-gold">
                  {reservation.vehicle.fleet_number}
                </Link>
              ) : (
                <span className="text-muted">—</span>
              )}
            </p>
            {assignable && options.length > 0 && (
              <div className="mt-3">
                <AssignVehicleForm reservationId={id} currentId={reservation.assigned_vehicle_id} options={options} />
              </div>
            )}
          </section>

          <section className="card p-6 text-[13px]">
            <h2 className="mb-2 text-sm font-semibold">{t("form.customer")}</h2>
            {reservation.customer && (
              <>
                <Link href={withBack(`/customers/${reservation.customer.id}`, here)} className="font-medium underline decoration-gold/50 underline-offset-4 hover:decoration-gold">
                  {reservation.customer.full_name}
                </Link>
                {reservation.customer.dnr_flag && (
                  <Badge tone="danger" className="ml-2">
                    DNR
                  </Badge>
                )}
                <p className="mt-1.5 text-charcoal">
                  {[reservation.customer.phone, reservation.customer.email, reservation.customer.wechat && `WeChat ${reservation.customer.wechat}`].filter(Boolean).join(" · ") || "—"}
                </p>
              </>
            )}
            {reservation.lead_id && can(session, "lead.view") && (
              <p className="mt-2">
                <Link href={withBack(`/leads/${reservation.lead_id}`, here)} className="text-charcoal underline decoration-gold/50 underline-offset-4">
                  {t("detail.viewLead")} →
                </Link>
              </p>
            )}
          </section>

          <section className="card p-6">
            <h2 className="mb-3 text-sm font-semibold">{t("detail.readiness")}</h2>
            <ReadinessControls
              reservationId={id}
              agreementHref={reservation.agreement_state === "SIGNED" ? `/reservations/${id}/agreement` : undefined}
              payment={reservation.payment_state}
              verification={reservation.verification_state}
              agreement={reservation.agreement_state}
              hold={reservation.hold_state}
              editable={can(session, "reservation.edit")}
            />
          </section>

          <section className="card p-6">
            <h2 className="text-sm font-semibold">{t("detail.activity")}</h2>
            <ol className="mt-3 flex flex-col gap-2.5">
              {activity.map((event) => (
                <li key={event.id} className="text-[13px]">
                  <p className="font-mono text-[12px] text-charcoal">
                    {event.action}
                    {typeof event.metadata.to === "string" && typeof event.metadata.from === "string" && /status_(changed|reverted)$/.test(event.action) ? ` · ${event.metadata.from} → ${event.metadata.to}` : ""}
                  </p>
                  <p className="text-xs text-muted">
                    {formatFullDateTime(event.created_at, locale)}
                    {typeof event.metadata.by === "string" ? ` · ${event.metadata.by}` : ""}
                  </p>
                </li>
              ))}
            </ol>
          </section>
        </div>
      </div>
    </>
  );
}
