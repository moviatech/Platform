"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { requireScope } from "@/lib/auth/scope";
import { requirePermission } from "@/lib/auth/staff";
import { createAdminClient } from "@/lib/supabase/admin";
import { refreshDriversPending } from "./service";

export type VerifyState = { ok?: boolean; error?: string; at?: number };

const uuid = z.uuid();

const photoPath = (reservationId: string, value: unknown) => {
  const prefix = `${reservationId}/pickup/`;
  return typeof value === "string" && value.startsWith(prefix) && /^[0-9a-f-]{36}\.(jpg|png|webp|heic|heif)$/.test(value.slice(prefix.length)) ? value : null;
};

const refresh = (reservationId: string) => revalidatePath(`/ops/reservations/${reservationId}`, "layout");

export async function verifyLicenseOnsite(_: VerifyState, form: FormData): Promise<VerifyState> {
  const session = await requirePermission("vehicle.inspect");
  const reservationId = uuid.safeParse(form.get("reservationId"));
  if (!reservationId.success) return { error: "invalid" };
  await requireScope(session, { reservation: reservationId.data });
  const photo = photoPath(reservationId.data, form.get("photo"));
  if (!photo || form.get("confirm") !== "on") return { error: "photo_required" };
  const { error } = await createAdminClient()
    .from("reservations")
    .update({ verification_state: "VERIFIED", license_onsite_photo: photo, license_onsite_by: session.userId, license_onsite_at: new Date().toISOString() })
    .eq("id", reservationId.data);
  if (error) return { error: "failed" };
  await audit({ actorUserId: session.userId, actorType: "STAFF", action: "reservation.license_verified_onsite", entityType: "reservation", entityId: reservationId.data, metadata: { by: session.displayName, photo } });
  refresh(reservationId.data);
  return { ok: true, at: Date.now() };
}

export async function verifyDriverOnsite(_: VerifyState, form: FormData): Promise<VerifyState> {
  const session = await requirePermission("vehicle.inspect");
  const parsed = z.object({ reservationId: uuid, driverId: uuid }).safeParse({ reservationId: form.get("reservationId"), driverId: form.get("driverId") });
  if (!parsed.success) return { error: "invalid" };
  await requireScope(session, { reservation: parsed.data.reservationId });
  const photo = photoPath(parsed.data.reservationId, form.get("photo"));
  if (!photo || form.get("confirm") !== "on") return { error: "photo_required" };
  const { error } = await createAdminClient()
    .from("reservation_drivers")
    .update({ status: "ONSITE", photo_path: photo, verified_by: session.userId, verified_at: new Date().toISOString() })
    .eq("id", parsed.data.driverId)
    .eq("reservation_id", parsed.data.reservationId);
  if (error) return { error: "failed" };
  await refreshDriversPending(parsed.data.reservationId);
  await audit({ actorUserId: session.userId, actorType: "STAFF", action: "driver.verified_onsite", entityType: "reservation", entityId: parsed.data.reservationId, metadata: { by: session.displayName, driverId: parsed.data.driverId, photo } });
  refresh(parsed.data.reservationId);
  return { ok: true, at: Date.now() };
}

export async function verifyInsurance(_: VerifyState, form: FormData): Promise<VerifyState> {
  const session = await requirePermission("vehicle.inspect");
  const reservationId = uuid.safeParse(form.get("reservationId"));
  if (!reservationId.success) return { error: "invalid" };
  await requireScope(session, { reservation: reservationId.data });
  const supabase = createAdminClient();
  const { data: reservation } = await supabase.from("reservations").select("insurance_state, insurance_proof_path").eq("id", reservationId.data).maybeSingle();
  if (!reservation || reservation.insurance_state === "NOT_REQUIRED") return { error: "invalid" };
  const proof = photoPath(reservationId.data, form.get("photo")) ?? reservation.insurance_proof_path;
  if (!proof || form.get("confirm") !== "on") return { error: "photo_required" };
  const { error } = await supabase
    .from("reservations")
    .update({ insurance_state: "VERIFIED", insurance_proof_path: proof, insurance_verified_by: session.userId, insurance_verified_at: new Date().toISOString() })
    .eq("id", reservationId.data);
  if (error) return { error: "failed" };
  await audit({ actorUserId: session.userId, actorType: "STAFF", action: "reservation.insurance_verified", entityType: "reservation", entityId: reservationId.data, metadata: { by: session.displayName, proof } });
  refresh(reservationId.data);
  return { ok: true, at: Date.now() };
}
