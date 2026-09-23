"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { attachmentBucket } from "@/features/portal/attachments";
import { requireScope, scopeAllows } from "@/lib/auth/scope";
import { requirePermission } from "@/lib/auth/staff";
import { createAdminClient } from "@/lib/supabase/admin";
import { confirmLicenseKind, refreshDriversPending } from "./service";
import { insuranceRequired, licenseKinds, protectionAllowed } from "./types";

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
  const kind = z.enum(licenseKinds).safeParse(form.get("licenseKind"));
  if (!kind.success) return { error: "invalid" };
  const photo = photoPath(reservationId.data, form.get("photo"));
  if (!photo || form.get("confirm") !== "on") return { error: "photo_required" };
  const supabase = createAdminClient();
  const { data: holder } = await supabase.from("reservations").select("customer_id").eq("id", reservationId.data).maybeSingle();
  if (!holder?.customer_id || !(await confirmLicenseKind(holder.customer_id, kind.data))) return { error: "failed" };
  const { error } = await supabase
    .from("reservations")
    .update({ verification_state: "VERIFIED", license_onsite_photo: photo, license_onsite_by: session.userId, license_onsite_at: new Date().toISOString() })
    .eq("id", reservationId.data);
  if (error) return { error: "failed" };
  await audit({ actorUserId: session.userId, actorType: "STAFF", action: "reservation.license_verified_onsite", entityType: "reservation", entityId: reservationId.data, metadata: { by: session.displayName, photo, kind: kind.data } });
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

export async function setLicenseKindOnsite(_: VerifyState, form: FormData): Promise<VerifyState> {
  const session = await requirePermission("vehicle.inspect");
  const parsed = z.object({ reservationId: uuid, licenseKind: z.enum(licenseKinds) }).safeParse({ reservationId: form.get("reservationId"), licenseKind: form.get("licenseKind") });
  if (!parsed.success) return { error: "invalid" };
  await requireScope(session, { reservation: parsed.data.reservationId });
  const supabase = createAdminClient();
  const { data: reservation } = await supabase.from("reservations").select("customer_id").eq("id", parsed.data.reservationId).maybeSingle();
  if (!reservation?.customer_id) return { error: "invalid" };
  if (!(await confirmLicenseKind(reservation.customer_id, parsed.data.licenseKind))) return { error: "failed" };
  await audit({ actorUserId: session.userId, actorType: "STAFF", action: "customer.license_kind_set", entityType: "customer", entityId: reservation.customer_id, metadata: { by: session.displayName, kind: parsed.data.licenseKind, reservationId: parsed.data.reservationId } });
  refresh(parsed.data.reservationId);
  return { ok: true, at: Date.now() };
}

const proofType = /^(image\/(jpeg|png|webp|heic|heif)|application\/pdf)$/;
const maxProofBytes = 10 * 1024 * 1024;
const closedStatuses = ["COMPLETED", "CANCELLED", "NO_SHOW", "EXPIRED"];

export async function createInsuranceUpload(reservationId: string, file: { type: string; size: number }): Promise<{ path: string; url: string } | null> {
  const session = await requirePermission("reservation.edit");
  if (!uuid.safeParse(reservationId).success || !proofType.test(file.type) || file.size > maxProofBytes) return null;
  if (!(await scopeAllows(session, { reservation: reservationId }))) return null;
  const supabase = createAdminClient();
  const { data: reservation } = await supabase.from("reservations").select("customer_id, status").eq("id", reservationId).maybeSingle();
  if (!reservation || closedStatuses.includes(reservation.status)) return null;
  const ext = file.type === "application/pdf" ? "pdf" : file.type.split("/")[1].replace("jpeg", "jpg");
  const path = `portal/${reservation.customer_id}/insurance/${randomUUID()}.${ext}`;
  const { data } = await supabase.storage.from(attachmentBucket).createSignedUploadUrl(path);
  return data ? { path, url: data.signedUrl } : null;
}

export async function saveInsuranceProof(reservationId: string, path: string): Promise<VerifyState> {
  const session = await requirePermission("reservation.edit");
  if (!uuid.safeParse(reservationId).success || typeof path !== "string") return { error: "invalid" };
  await requireScope(session, { reservation: reservationId });
  const supabase = createAdminClient();
  const { data } = await supabase.from("reservations").select("customer_id, status, protection, customer:customers(license_kind)").eq("id", reservationId).maybeSingle();
  const row = data as unknown as { customer_id: string; status: string; protection: string; customer: { license_kind: string | null } | null } | null;
  if (!row || closedStatuses.includes(row.status)) return { error: "invalid" };
  const prefix = `portal/${row.customer_id}/insurance/`;
  if (!path.startsWith(prefix) || !/^[0-9a-f-]{36}\.(jpg|png|webp|heic|heif|pdf)$/.test(path.slice(prefix.length))) return { error: "invalid" };
  const required = insuranceRequired(row.protection, row.customer?.license_kind);
  const { error } = await supabase
    .from("reservations")
    .update({ insurance_proof_path: path, insurance_state: required ? "UPLOADED" : "NOT_REQUIRED", insurance_verified_by: null, insurance_verified_at: null })
    .eq("id", reservationId);
  if (error) return { error: "failed" };
  await audit({ actorUserId: session.userId, actorType: "STAFF", action: "reservation.insurance_uploaded", entityType: "reservation", entityId: reservationId, metadata: { by: session.displayName, path } });
  refresh(reservationId);
  return { ok: true, at: Date.now() };
}

export async function verifyInsurance(_: VerifyState, form: FormData): Promise<VerifyState> {
  const session = await requirePermission("vehicle.inspect");
  const reservationId = uuid.safeParse(form.get("reservationId"));
  if (!reservationId.success) return { error: "invalid" };
  await requireScope(session, { reservation: reservationId.data });
  const supabase = createAdminClient();
  const { data: reservation } = await supabase.from("reservations").select("insurance_state, insurance_proof_path, protection, customer:customers(license_kind)").eq("id", reservationId.data).maybeSingle();
  if (!reservation || reservation.insurance_state === "NOT_REQUIRED") return { error: "invalid" };
  if (!protectionAllowed(reservation.protection, (reservation.customer as unknown as { license_kind: string | null } | null)?.license_kind)) return { error: "protection_required" };
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
