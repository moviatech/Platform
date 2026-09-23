"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { attachmentBucket } from "@/features/portal/attachments";
import { audit } from "@/lib/audit";
import { getVerifiedCustomer } from "@/lib/auth/customer";
import { portalOrigin } from "@/lib/env";
import { getStripe, stripeConfigured } from "@/lib/stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { refreshDriversPending } from "./service";
import { driverDone, licenseKinds, type DriverStatus } from "./types";

export type DriverActionState = { url?: string; error?: string };
export type ProofState = { ok?: boolean; error?: string };

const numberInput = z.string().regex(/^MV-[A-Z0-9]{6}$/);
const uuid = z.uuid();
const proofType = /^(image\/(jpeg|png|webp|heic|heif)|application\/pdf)$/;
const maxProofBytes = 10 * 1024 * 1024;

type OwnedDriver = { id: string; status: DriverStatus; position: number; reservation: { id: string; number: string; customer_id: string } };

async function ownedDriver(driverId: string) {
  const session = await getVerifiedCustomer();
  if (!session) redirect("/login");
  const { data } = await createAdminClient().from("reservation_drivers").select("id, status, position, reservation:reservations!inner(id, number, customer_id)").eq("id", driverId).maybeSingle();
  const row = data as unknown as OwnedDriver | null;
  return { session, row: row && row.reservation.customer_id === session.customerId ? row : null };
}

export async function startDriverVerification(_: DriverActionState, form: FormData): Promise<DriverActionState> {
  const parsed = uuid.safeParse(form.get("driverId"));
  if (!parsed.success) return { error: "invalid" };
  const { session, row } = await ownedDriver(parsed.data);
  if (!row || driverDone(row.status)) return { error: "invalid" };
  if (!stripeConfigured()) return { error: "identity_unavailable" };
  try {
    const verification = await getStripe().identity.verificationSessions.create({
      type: "document",
      client_reference_id: `${row.reservation.number}-D${row.position}`,
      metadata: { customer_id: session.customerId, reservation_id: row.reservation.id, driver_id: row.id },
      options: { document: { allowed_types: ["driving_license"], require_matching_selfie: true, require_live_capture: true } },
      return_url: `${portalOrigin}/trips/${row.reservation.number}?driver=submitted`,
    });
    await createAdminClient().from("reservation_drivers").update({ status: "SUBMITTED", identity_session_id: verification.id, international: false }).eq("id", row.id);
    await refreshDriversPending(row.reservation.id);
    await audit({ actorUserId: session.userId, actorType: "CUSTOMER", action: "driver.identity_started", entityType: "reservation", entityId: row.reservation.id, metadata: { driverId: row.id, position: row.position, sessionId: verification.id } });
    revalidatePath(`/account/trips/${row.reservation.number}`);
    return verification.url ? { url: verification.url } : { error: "identity_unavailable" };
  } catch (cause) {
    console.error("[identity:driver]", cause instanceof Error ? cause.message : cause);
    return { error: "identity_unavailable" };
  }
}

export async function markDriverInternational(form: FormData) {
  const parsed = z.object({ driverId: uuid, international: z.enum(["1", "0"]) }).safeParse({ driverId: form.get("driverId"), international: form.get("international") ?? "1" });
  if (!parsed.success) return;
  const { session, row } = await ownedDriver(parsed.data.driverId);
  if (!row || driverDone(row.status)) return;
  await createAdminClient().from("reservation_drivers").update({ international: parsed.data.international === "1", status: "PENDING", identity_session_id: null }).eq("id", row.id);
  await refreshDriversPending(row.reservation.id);
  await audit({ actorUserId: session.userId, actorType: "CUSTOMER", action: "driver.license_kind_set", entityType: "reservation", entityId: row.reservation.id, metadata: { driverId: row.id, international: parsed.data.international === "1" } });
  revalidatePath(`/account/trips/${row.reservation.number}`);
}

export async function setLicenseKind(form: FormData) {
  const session = await getVerifiedCustomer();
  if (!session) redirect("/login");
  const parsed = z.enum(licenseKinds).safeParse(form.get("licenseKind"));
  if (!parsed.success) return;
  await createAdminClient().from("customers").update({ license_kind: parsed.data }).eq("id", session.customerId);
  await audit({ actorUserId: session.userId, actorType: "CUSTOMER", action: "customer.license_kind_set", entityType: "customer", entityId: session.customerId, metadata: { kind: parsed.data } });
  revalidatePath("/account", "layout");
}

export async function createProofUpload(number: string, file: { type: string; size: number }): Promise<{ path: string; url: string } | null> {
  const session = await getVerifiedCustomer();
  if (!session || !numberInput.safeParse(number).success) return null;
  if (!proofType.test(file.type) || file.size > maxProofBytes) return null;
  const ext = file.type === "application/pdf" ? "pdf" : file.type.split("/")[1].replace("jpeg", "jpg");
  const path = `portal/${session.customerId}/insurance/${randomUUID()}.${ext}`;
  const { data } = await createAdminClient().storage.from(attachmentBucket).createSignedUploadUrl(path);
  return data ? { path, url: data.signedUrl } : null;
}

export async function submitInsuranceProof(_: ProofState, form: FormData): Promise<ProofState> {
  const session = await getVerifiedCustomer();
  if (!session) redirect("/login");
  const parsed = z.object({ number: numberInput, path: z.string().max(200) }).safeParse({ number: form.get("number"), path: form.get("path") });
  if (!parsed.success || !parsed.data.path.startsWith(`portal/${session.customerId}/insurance/`)) return { error: "invalid" };
  const supabase = createAdminClient();
  const { data: reservation } = await supabase.from("reservations").select("id, insurance_state").eq("number", parsed.data.number).eq("customer_id", session.customerId).maybeSingle();
  if (!reservation || reservation.insurance_state === "NOT_REQUIRED") return { error: "invalid" };
  await supabase.from("reservations").update({ insurance_state: "UPLOADED", insurance_proof_path: parsed.data.path, insurance_verified_by: null, insurance_verified_at: null }).eq("id", reservation.id);
  await audit({ actorUserId: session.userId, actorType: "CUSTOMER", action: "reservation.insurance_uploaded", entityType: "reservation", entityId: reservation.id, metadata: { path: parsed.data.path } });
  revalidatePath(`/account/trips/${parsed.data.number}`);
  return { ok: true };
}
