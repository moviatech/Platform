"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { BookingError } from "@/features/booking/service";
import type { Quote } from "@/features/pricing/quote";
import { audit } from "@/lib/audit";
import { requirePermission } from "@/lib/auth/staff";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ReservationActionState } from "./actions";
import { applyChange, editableStatuses, loadEditableReservation, previewChange, recomputeTotal, type ChangeInput } from "./apply-change";

export type EditState = { values?: Record<string, string>; addOns?: string[]; quote?: Quote; available?: number; error?: string };

const uuid = z.uuid();
const text = (form: FormData, key: string) => String(form.get(key) ?? "");

export async function editReservation(_: EditState, form: FormData): Promise<EditState> {
  const session = await requirePermission("reservation.edit");
  const reservationId = text(form, "reservationId");
  if (!uuid.safeParse(reservationId).success) return { error: "invalid" };
  const intent = text(form, "intent");
  const addOns = form.getAll("addOns").map(String);
  const values: Record<string, string> = {};
  for (const key of ["classSlug", "pickupDate", "pickupTime", "returnDate", "returnTime", "protection", "ageBand", "pickupMethod", "deliveryAddress"]) values[key] = text(form, key);
  const input: ChangeInput = { ...(values as Omit<ChangeInput, "addOns">), addOns };

  const reservation = await loadEditableReservation(reservationId);
  if (!reservation) return { error: "not_found" };
  if (!editableStatuses.includes(reservation.status) && reservation.status !== "ACTIVE") return { values, addOns, error: "reservation_closed" };

  try {
    if (intent !== "save") {
      const preview = await previewChange(reservation, input);
      return { values, addOns, quote: preview.quote, available: preview.available };
    }
    await applyChange(reservation, input, { userId: session.userId, displayName: session.displayName });
    revalidatePath("/ops", "layout");
  } catch (cause) {
    if (cause instanceof BookingError) return { values, addOns, error: cause.code };
    throw cause;
  }
  redirect(`/reservations/${reservationId}`);
}

const adjustmentInput = z.object({
  reservationId: uuid,
  kind: z.enum(["fee", "discount"]),
  description: z.string().trim().min(2).max(120),
  amount: z
    .string()
    .trim()
    .regex(/^\d{1,6}(\.\d{1,2})?$/)
    .transform((value) => Math.round(Number(value) * 100)),
});

export async function addAdjustment(_: ReservationActionState, form: FormData): Promise<ReservationActionState> {
  const session = await requirePermission("reservation.edit");
  const parsed = adjustmentInput.safeParse({ reservationId: form.get("reservationId"), kind: form.get("kind"), description: form.get("description"), amount: form.get("amount") });
  if (!parsed.success) return { error: "invalid" };
  const { reservationId, kind, description, amount } = parsed.data;
  if (amount === 0) return { error: "invalid" };

  const supabase = createAdminClient();
  const { data: reservation } = await supabase.from("reservations").select("status, number").eq("id", reservationId).maybeSingle();
  if (!reservation) return { error: "not_found" };
  if (["CANCELLED", "NO_SHOW", "EXPIRED"].includes(reservation.status)) return { error: "reservation_closed" };

  const cents = kind === "fee" ? amount : -amount;
  const { error } = await supabase.from("reservation_line_items").insert({
    reservation_id: reservationId,
    type: kind === "fee" ? "ADDITIONAL" : "DISCOUNT",
    code: `manual.${kind}`,
    description,
    quantity: 1,
    unit_cents: cents,
    amount_cents: cents,
    taxable: false,
    sort_order: 200,
  });
  if (error) return { error: "failed" };
  const total = await recomputeTotal(reservationId);
  await audit({ actorUserId: session.userId, actorType: "STAFF", action: "reservation.adjustment_added", entityType: "reservation", entityId: reservationId, metadata: { by: session.displayName, number: reservation.number, kind, description, amountCents: cents, totalCents: total } });
  revalidatePath(`/ops/reservations/${reservationId}`);
  return { ok: true };
}

export async function removeAdjustment(form: FormData) {
  const session = await requirePermission("reservation.edit");
  const parsed = z.object({ reservationId: uuid, lineId: uuid }).safeParse({ reservationId: form.get("reservationId"), lineId: form.get("lineId") });
  if (!parsed.success) return;
  const supabase = createAdminClient();
  const { data: line } = await supabase.from("reservation_line_items").select("id, code, description, amount_cents").eq("id", parsed.data.lineId).eq("reservation_id", parsed.data.reservationId).maybeSingle();
  if (!line || !line.code.startsWith("manual.")) return;
  await supabase.from("reservation_line_items").delete().eq("id", line.id);
  const total = await recomputeTotal(parsed.data.reservationId);
  await audit({ actorUserId: session.userId, actorType: "STAFF", action: "reservation.adjustment_removed", entityType: "reservation", entityId: parsed.data.reservationId, metadata: { by: session.displayName, description: line.description, amountCents: line.amount_cents, totalCents: total } });
  revalidatePath(`/ops/reservations/${parsed.data.reservationId}`);
}
