"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { BookingError, countAvailable, createReservation, priceTrip, tripSchema } from "@/features/booking/service";
import { approvalThresholdCents, requestApproval } from "@/features/finance/approvals";
import { notifyReservation } from "@/features/notifications/emails";
import { neverConfirmed, settleCancellation, type Collection, type Settlement } from "@/features/payments/cancel-settlement";
import { bookingSecured, customerHasCard } from "@/features/payments/service";
import type { Quote } from "@/features/pricing/quote";
import { audit } from "@/lib/audit";
import { can, requirePermission } from "@/lib/auth/staff";
import { requireScope, scopeAllows } from "@/lib/auth/scope";
import { stripeConfigured } from "@/lib/stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { adjustmentTotal, immediateAdjustments, readAdjustments, type AdjustmentDraft } from "./adjustment";
import { addManualLine } from "./apply-change";
import { bookingSources, reservationStatuses, transitions, type ReservationStatus } from "./types";

export type DraftValues = Record<string, string>;

export type DraftState = {
  values?: DraftValues;
  addOns?: string[];
  quote?: Quote;
  available?: Array<{ id: string; fleetNumber: string }>;
  couponError?: string;
  error?: string;
};

const customerSchema = z.object({
  fullName: z.string().trim().min(1).max(120),
  email: z.union([z.email().max(200), z.literal("")]),
  phone: z.string().trim().max(40),
  wechat: z.string().trim().max(60),
  language: z.enum(["zh", "en"]),
});

const extraSchema = z.object({
  source: z.enum(bookingSources),
  vehicleId: z.union([z.uuid(), z.literal("")]),
  deliveryAddress: z.string().trim().max(300),
  customerNotes: z.string().trim().max(2000),
  internalNotes: z.string().trim().max(2000),
  initialStatus: z.enum(["CONFIRMED", "REQUESTED"]),
});

const text = (form: FormData, key: string) => String(form.get(key) ?? "");

function adjustmentDrafts(form: FormData): AdjustmentDraft[] | null {
  const kinds = form.getAll("adjustKind").map(String);
  const notes = form.getAll("adjustNote").map(String);
  const amounts = form.getAll("adjustAmount").map(String);
  if (kinds.length !== amounts.length || notes.length !== amounts.length) return null;
  return amounts.map((amount, index) => ({ kind: kinds[index] === "fee" ? "fee" : "discount", note: notes[index], amount }));
}

export async function draftReservation(_: DraftState, form: FormData): Promise<DraftState> {
  const session = await requirePermission("reservation.create");
  const intent = text(form, "intent");
  const addOns = form.getAll("addOns").map(String);
  const values: DraftValues = {};
  for (const key of [
    "classSlug", "pickupDate", "pickupTime", "returnDate", "returnTime", "protection", "ratePlan", "ageBand", "pickupMethod",
    "fullName", "email", "phone", "wechat", "language", "source", "vehicleId", "deliveryAddress", "customerNotes", "internalNotes", "initialStatus", "leadId", "locationId", "extraDrivers", "spouseDriver", "couponCode",
  ]) {
    values[key] = text(form, key);
  }

  const trip = tripSchema.safeParse({ ...values, addOns });
  if (!trip.success || values.locationId === "") return { values, addOns, error: "invalid_trip" };

  try {
    await requireScope(session, { location: trip.data.locationId ?? null });
    const priced = await priceTrip(trip.data, { enforceLeadTime: false, coupon: { soft: intent !== "create" } });
    const available = await countAvailable(priced.vehicleClass.id, priced.pickupAt, priced.returnAt, priced.location.id);
    const drafts = adjustmentDrafts(form);
    const adjustments = drafts ? readAdjustments(drafts) : null;
    const adjustCents = adjustments ? adjustmentTotal(adjustments) : 0;
    const draft = { values, addOns, quote: priced.quote, available, couponError: priced.couponError };
    if (!adjustments || (adjustments.length > 0 && !can(session, "reservation.edit")) || priced.quote.totalCents + adjustCents < 0) return { ...draft, error: "invalid_adjustment" };

    if (intent !== "create") return draft;

    const immediate = immediateAdjustments(adjustments, session.permissions.has("finance.approve") ? null : approvalThresholdCents);
    const customer = customerSchema.safeParse(values);
    const extra = extraSchema.safeParse(values);
    if (!customer.success || !extra.success) return { ...draft, error: "invalid_customer" };
    if (!customer.data.email && !customer.data.phone && !customer.data.wechat) {
      return { ...draft, error: "contact_required" };
    }
    if (extra.data.initialStatus === "CONFIRMED" && stripeConfigured() && priced.quote.totalCents + adjustmentTotal(immediate) > 0 && !(await customerHasCard(customer.data.email || null))) {
      return { ...draft, error: "card_required_new" };
    }

    const created = await createReservation({
      priced,
      trip: trip.data,
      customer: {
        fullName: customer.data.fullName,
        email: customer.data.email || null,
        phone: customer.data.phone || null,
        wechat: customer.data.wechat || null,
        language: customer.data.language,
      },
      vehicleId: extra.data.vehicleId || null,
      status: extra.data.initialStatus,
      source: extra.data.source,
      expiresAt: extra.data.initialStatus === "REQUESTED" ? new Date(Date.now() + priced.config.requestHoldHours * 3600000) : null,
      deliveryAddress: extra.data.deliveryAddress || null,
      customerNotes: extra.data.customerNotes || null,
      internalNotes: extra.data.internalNotes || null,
      leadId: /^[0-9a-f-]{36}$/i.test(values.leadId) ? values.leadId : null,
      createdBy: session.userId,
    });
    if (/^[0-9a-f-]{36}$/i.test(values.leadId)) {
      await createAdminClient().from("leads").update({ status: "CONVERTED" }).eq("id", values.leadId);
    }

    await audit({
      actorUserId: session.userId,
      actorType: "STAFF",
      action: "reservation.created",
      entityType: "reservation",
      entityId: created.id,
      metadata: { by: session.displayName, number: created.number, source: extra.data.source, totalCents: priced.quote.totalCents, coupon: priced.coupon?.code },
    });
    for (const adjustment of adjustments) {
      if (!immediate.includes(adjustment)) {
        await requestApproval({ kind: "DISCOUNT", reservationId: created.id, amountCents: adjustment.cents, reason: adjustment.note, payload: { description: adjustment.note }, requestedBy: session.userId, requesterName: session.displayName });
      } else {
        const applied = await addManualLine({ reservationId: created.id, kind: adjustment.kind, description: adjustment.note, amountCents: adjustment.cents });
        if (applied) await audit({ actorUserId: session.userId, actorType: "STAFF", action: "reservation.adjustment_added", entityType: "reservation", entityId: created.id, metadata: { by: session.displayName, number: created.number, kind: adjustment.kind, description: adjustment.note, amountCents: applied.cents, totalCents: applied.totalCents } });
      }
    }
    if (extra.data.initialStatus === "CONFIRMED") await notifyReservation("confirmed", created.id, { dedupeKey: `confirmed:${created.id}` }).catch(() => undefined);
    else if (extra.data.initialStatus === "REQUESTED") await notifyReservation("requested", created.id).catch(() => undefined);
    revalidatePath("/ops", "layout");
    redirect(`/reservations/${created.id}`);
  } catch (cause) {
    if (cause instanceof BookingError) return { values, addOns, error: cause.code };
    throw cause;
  }
}

export type ReservationActionState = { ok?: boolean; error?: string; pending?: boolean; relink?: boolean; settlement?: Settlement; collection?: Collection };

const statusInput = z.object({
  reservationId: z.uuid(),
  status: z.enum(reservationStatuses),
  reason: z.string().trim().max(500),
});

export async function changeReservationStatus(_: ReservationActionState, form: FormData): Promise<ReservationActionState> {
  const parsed = statusInput.safeParse({ reservationId: form.get("reservationId"), status: form.get("status"), reason: form.get("reason") ?? "" });
  if (!parsed.success) return { error: "invalid" };
  const { reservationId, status, reason } = parsed.data;
  if (status === "ACTIVE" || status === "COMPLETED") return { error: "use_handover" };

  const session = await requirePermission(status === "CANCELLED" || status === "NO_SHOW" ? "reservation.cancel" : "reservation.edit");
  await requireScope(session, { reservation: reservationId });
  const supabase = createAdminClient();
  const { data: before } = await supabase.from("reservations").select("status, number").eq("id", reservationId).maybeSingle();
  if (!before) return { error: "not_found" };
  if (!transitions[before.status as ReservationStatus]?.includes(status)) return { error: "invalid_transition" };
  const waived = form.get("waiveFee") === "on" && (status === "CANCELLED" || status === "NO_SHOW");
  if (waived && !session.permissions.has("finance.approve")) return { error: "waive_forbidden" };
  if (status === "CONFIRMED" && stripeConfigured() && !(await bookingSecured(reservationId))) return { error: "card_required" };

  const { error } = await supabase.rpc("set_reservation_status", { p_reservation_id: reservationId, p_status: status, p_reason: reason || null });
  if (error) {
    const code = ["invalid_transition", "vehicle_required"].find((item) => error.message.includes(item));
    return { error: code ?? "failed" };
  }

  await audit({
    actorUserId: session.userId,
    actorType: "STAFF",
    action: "reservation.status_changed",
    entityType: "reservation",
    entityId: reservationId,
    metadata: { by: session.displayName, number: before.number, from: before.status, to: status, reason: reason || undefined, feeWaived: waived || undefined },
  });

  let settlement: Settlement | undefined;
  if (status === "CANCELLED" || status === "NO_SHOW") {
    settlement = await settleCancellation(reservationId, status === "NO_SHOW", { userId: session.userId, type: "STAFF", createdBy: session.userId }, { waiveFee: waived || neverConfirmed(before.status) });
    await notifyReservation("cancelled", reservationId, { feeCents: settlement.feeCents, refundedCents: settlement.refundedCents, offlineDueCents: settlement.offlineDueCents }).catch(() => undefined);
  } else if (status === "CONFIRMED") {
    await notifyReservation("confirmed", reservationId).catch(() => undefined);
  }
  revalidatePath("/ops", "layout");
  return { ok: true, settlement };
}

const assignInput = z.object({ reservationId: z.uuid(), vehicleId: z.uuid() });

export async function assignVehicle(_: ReservationActionState, form: FormData): Promise<ReservationActionState> {
  const session = await requirePermission("reservation.assign_vehicle");
  const parsed = assignInput.safeParse({ reservationId: form.get("reservationId"), vehicleId: form.get("vehicleId") });
  if (!parsed.success) return { error: "invalid" };
  await requireScope(session, { reservation: parsed.data.reservationId });
  await requireScope(session, { vehicle: parsed.data.vehicleId });

  const supabase = createAdminClient();
  const { data: before } = await supabase.from("reservations").select("assigned_vehicle_id, number").eq("id", parsed.data.reservationId).maybeSingle();
  const { error } = await supabase.rpc("assign_reservation_vehicle", { p_reservation_id: parsed.data.reservationId, p_vehicle_id: parsed.data.vehicleId });
  if (error) {
    const code = ["vehicle_not_available", "reservation_not_assignable"].find((item) => error.message.includes(item));
    return { error: code ?? (error.code === "23P01" ? "vehicle_not_available" : "failed") };
  }

  await audit({
    actorUserId: session.userId,
    actorType: "STAFF",
    action: "reservation.vehicle_assigned",
    entityType: "reservation",
    entityId: parsed.data.reservationId,
    metadata: { by: session.displayName, number: before?.number, from: before?.assigned_vehicle_id, to: parsed.data.vehicleId },
  });
  revalidatePath("/ops", "layout");
  return { ok: true };
}

const notesInput = z.object({ reservationId: z.uuid(), internalNotes: z.string().trim().max(4000) });

export async function saveReservationNotes(_: ReservationActionState, form: FormData): Promise<ReservationActionState> {
  const session = await requirePermission("reservation.edit");
  const parsed = notesInput.safeParse({ reservationId: form.get("reservationId"), internalNotes: form.get("internalNotes") ?? "" });
  if (!parsed.success) return { error: "invalid" };
  await requireScope(session, { reservation: parsed.data.reservationId });
  const { error } = await createAdminClient()
    .from("reservations")
    .update({ internal_notes: parsed.data.internalNotes || null })
    .eq("id", parsed.data.reservationId);
  if (error) return { error: "failed" };
  await audit({
    actorUserId: session.userId,
    actorType: "STAFF",
    action: "reservation.notes_updated",
    entityType: "reservation",
    entityId: parsed.data.reservationId,
    metadata: { by: session.displayName },
  });
  revalidatePath(`/ops/reservations/${parsed.data.reservationId}`);
  return { ok: true };
}

export async function listAssignableVehicles(reservationId: string) {
  const session = await requirePermission("reservation.view");
  if (!can(session, "reservation.assign_vehicle")) return [];
  if (!(await scopeAllows(session, { reservation: reservationId }))) return [];
  const supabase = createAdminClient();
  const [{ data: reservation }, { data: classes }] = await Promise.all([
    supabase.from("reservations").select("status, class_id, pickup_at, return_at, pickup_location_id").eq("id", reservationId).maybeSingle(),
    supabase.from("vehicle_classes").select("id").eq("active", true),
  ]);
  if (!reservation || !["REQUESTED", "PENDING_PAYMENT", "CONFIRMED"].includes(reservation.status)) return [];
  const results = await Promise.all(
    (classes ?? []).map((item) =>
      supabase.rpc("available_vehicles", {
        p_class_id: item.id,
        p_pickup_at: reservation.pickup_at,
        p_return_at: reservation.return_at,
        p_ignore_reservation: reservationId,
        p_location_id: reservation.pickup_location_id,
      }),
    ),
  );
  return results.flatMap((result) => (result.data as Array<{ id: string; fleet_number: string; class_id: string }> | null) ?? []).map((row) => ({
    id: row.id,
    fleetNumber: row.fleet_number,
    sameClass: row.class_id === reservation.class_id,
  }));
}
