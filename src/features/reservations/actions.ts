"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { BookingError, countAvailable, createReservation, priceTrip, tripSchema } from "@/features/booking/service";
import { notifyReservation } from "@/features/notifications/emails";
import { settleCancellation, type Collection, type Settlement } from "@/features/payments/cancel-settlement";
import type { Quote } from "@/features/pricing/quote";
import { audit } from "@/lib/audit";
import { can, requirePermission } from "@/lib/auth/staff";
import { createAdminClient } from "@/lib/supabase/admin";
import { bookingSources, reservationStatuses, transitions, type ReservationStatus } from "./types";

export type DraftValues = Record<string, string>;

export type DraftState = {
  values?: DraftValues;
  addOns?: string[];
  quote?: Quote;
  available?: Array<{ id: string; fleetNumber: string }>;
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

export async function draftReservation(_: DraftState, form: FormData): Promise<DraftState> {
  const session = await requirePermission("reservation.create");
  const intent = text(form, "intent");
  const addOns = form.getAll("addOns").map(String);
  const values: DraftValues = {};
  for (const key of [
    "classSlug", "pickupDate", "pickupTime", "returnDate", "returnTime", "protection", "ratePlan", "ageBand", "pickupMethod",
    "fullName", "email", "phone", "wechat", "language", "source", "vehicleId", "deliveryAddress", "customerNotes", "internalNotes", "initialStatus", "leadId",
  ]) {
    values[key] = text(form, key);
  }

  const trip = tripSchema.safeParse({ ...values, addOns });
  if (!trip.success) return { values, addOns, error: "invalid_trip" };

  try {
    const priced = await priceTrip(trip.data, { enforceLeadTime: false });
    const available = await countAvailable(priced.vehicleClass.id, priced.pickupAt, priced.returnAt);

    if (intent !== "create") return { values, addOns, quote: priced.quote, available };

    const customer = customerSchema.safeParse(values);
    const extra = extraSchema.safeParse(values);
    if (!customer.success || !extra.success) return { values, addOns, quote: priced.quote, available, error: "invalid_customer" };
    if (!customer.data.email && !customer.data.phone && !customer.data.wechat) {
      return { values, addOns, quote: priced.quote, available, error: "contact_required" };
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
      metadata: { by: session.displayName, number: created.number, source: extra.data.source, totalCents: priced.quote.totalCents },
    });
    revalidatePath("/ops", "layout");
    redirect(`/reservations/${created.id}`);
  } catch (cause) {
    if (cause instanceof BookingError) return { values, addOns, error: cause.code };
    throw cause;
  }
}

export type ReservationActionState = { ok?: boolean; error?: string; settlement?: Settlement; collection?: Collection };

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
  const supabase = createAdminClient();
  const { data: before } = await supabase.from("reservations").select("status, number").eq("id", reservationId).maybeSingle();
  if (!before) return { error: "not_found" };
  if (!transitions[before.status as ReservationStatus]?.includes(status)) return { error: "invalid_transition" };

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
    metadata: { by: session.displayName, number: before.number, from: before.status, to: status, reason: reason || undefined },
  });

  let settlement: Settlement | undefined;
  if (status === "CANCELLED" || status === "NO_SHOW") {
    settlement = await settleCancellation(reservationId, status === "NO_SHOW", { userId: session.userId, type: "STAFF", createdBy: session.userId });
    await notifyReservation("cancelled", reservationId).catch(() => undefined);
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
  const supabase = createAdminClient();
  const { data: reservation } = await supabase.from("reservations").select("class_id, pickup_at, return_at").eq("id", reservationId).maybeSingle();
  if (!reservation) return [];
  const { data: classes } = await supabase.from("vehicle_classes").select("id").eq("active", true);
  const results = await Promise.all(
    (classes ?? []).map((item) =>
      supabase.rpc("available_vehicles", {
        p_class_id: item.id,
        p_pickup_at: reservation.pickup_at,
        p_return_at: reservation.return_at,
        p_ignore_reservation: reservationId,
      }),
    ),
  );
  return results.flatMap((result) => (result.data as Array<{ id: string; fleet_number: string; class_id: string }> | null) ?? []).map((row) => ({
    id: row.id,
    fleetNumber: row.fleet_number,
    sameClass: row.class_id === reservation.class_id,
  }));
}
