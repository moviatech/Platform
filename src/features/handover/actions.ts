"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getLocale } from "next-intl/server";
import { isLocale } from "@/i18n/config";
import { z } from "zod";
import { collectBalanceAtStart } from "@/features/payments/cancel-settlement";
import { payLinkRecipient, sendPayLinkEmail } from "@/features/payments/link-email";
import { captureHold, chargeSavedCard, createCheckout, PaymentError, placeSecurityHold, releaseHold } from "@/features/payments/service";
import { agreementVersion, isLongTerm, renderAgreement, signatureImageInput, type Elections } from "@/features/portal/agreement";
import { loadAgreementFacts, recordSignature } from "@/features/portal/agreement-facts";
import { onsiteConsentText } from "@/features/claims/consent";
import { chargeClaim, consentClaimOnsite, createDamageClaim, listClaims, onsiteDamage, settleClaimFromHold, signedOnsite, type ClaimRow } from "@/features/claims/service";
import { notifyStaff } from "@/features/notifications/center";
import { notifyOpsEmail } from "@/features/notifications/ops";
import { opsOrigin } from "@/lib/env";
import { formatMoney } from "@/lib/utils/format";
import { vehiclePhotoProgress } from "@/features/fleet/photos";
import { notifyReturnSettlement } from "@/features/notifications/receipts";
import { recordReading } from "@/features/investor/mileage";
import { postRentalShare } from "@/features/investor/share";
import { openPrepTask } from "@/features/prep/service";
import { sendTripSurvey } from "@/features/ratings/survey";
import { audit } from "@/lib/audit";
import { clientIpFrom } from "@/lib/auth/client-ip";
import { requirePermission } from "@/lib/auth/staff";
import { requireScope, scopeAllows } from "@/lib/auth/scope";
import { stripeConfigured } from "@/lib/stripe";
import { presignUpload, r2Configured } from "@/lib/media/r2";
import { createAdminClient } from "@/lib/supabase/admin";
import { zonedToUtc } from "@/features/booking/time";
import { computeReturnFees, feeTotal, type FeeLine } from "./fees";
import { insuranceOk, protectionAllowed } from "@/features/drivers/types";
import { taxAt } from "@/features/pricing/quote";
import { revokeForReservation, superchargingFor } from "@/features/tesla/service";
import { loadReturnParams } from "./queries";
import { maxPhotoBytes, maxPhotos, maxVideoBytes, maxVideoSeconds, photoBucket, videoRetentionDays, type DamageConfirmState, type HandoverState, type InspectionKind, type PickupPayState, type UploadTarget, type UploadedPhoto, type UploadedVideo, type VideoTarget } from "./types";

const uuid = z.uuid();
const imageType = /^image\/(jpeg|png|webp|heic|heif)$/;
const bool = (value: FormDataEntryValue | null) => value === "on";
const dollars = z
  .string()
  .trim()
  .regex(/^(\d{1,6}(\.\d{1,2})?)?$/)
  .transform((value) => (value ? Math.round(Number(value) * 100) : 0));
const photoSchema = z.array(z.object({ path: z.string().max(200), type: z.string().regex(imageType), size: z.number().int().min(0).max(maxPhotoBytes) })).max(maxPhotos);
const videoType = /^video\/(mp4|quicktime|webm|x-m4v|3gpp)$/;
const videoSchema = z.array(z.object({ key: z.string().max(200), type: z.string().regex(videoType), size: z.number().int().min(0).max(maxVideoBytes), duration: z.number().min(0).max(maxVideoSeconds + 1) })).max(2);
const requestId = /^[a-z0-9-]{1,40}$/;

function parseVideos(raw: FormDataEntryValue | null, reservationId: string, kind: InspectionKind): UploadedVideo[] | null {
  let parsed: unknown = [];
  try {
    parsed = raw ? JSON.parse(String(raw)) : [];
  } catch {
    return null;
  }
  const result = videoSchema.safeParse(parsed);
  if (!result.success) return null;
  const prefix = `inspections/${reservationId}/${kind.toLowerCase()}/`;
  return result.data.every((video) => video.key.startsWith(prefix) && /^[0-9a-f-]{36}\.[a-z0-9]{2,4}$/.test(video.key.slice(prefix.length))) ? result.data : null;
}

function missingRequests(form: FormData) {
  const ids = String(form.get("requestIds") ?? "").split("|").filter((id) => requestId.test(id));
  return ids.filter((id) => !bool(form.get(`req_${id}`)));
}

async function storeVideos(input: { videos: UploadedVideo[]; reservationId: string; vehicleId: string; inspectionId: string; kind: InspectionKind; userId: string }) {
  if (!input.videos.length) return;
  await createAdminClient().from("media").insert(
    input.videos.map((video) => ({
      kind: "VIDEO",
      scope: input.kind,
      reservation_id: input.reservationId,
      vehicle_id: input.vehicleId,
      inspection_id: input.inspectionId,
      storage_key: video.key,
      content_type: video.type,
      size_bytes: video.size,
      duration_seconds: Math.round(video.duration),
      created_by: input.userId,
      expires_at: new Date(Date.now() + videoRetentionDays * 86400000).toISOString(),
    })),
  );
}

export async function createVideoUpload(reservationId: string, kind: InspectionKind, file: { type: string; size: number }): Promise<VideoTarget> {
  const session = await requirePermission("vehicle.inspect");
  if (!r2Configured() || !uuid.safeParse(reservationId).success || !videoType.test(file.type) || file.size > maxVideoBytes) return null;
  if (!(await scopeAllows(session, { reservation: reservationId }))) return null;
  const ext = file.type === "video/quicktime" ? "mov" : file.type === "video/x-m4v" ? "m4v" : file.type.split("/")[1];
  const key = `inspections/${reservationId}/${kind.toLowerCase()}/${randomUUID()}.${ext}`;
  try {
    return { key, url: await presignUpload(key, file.type) };
  } catch {
    return null;
  }
}

function parsePhotos(raw: FormDataEntryValue | null, reservationId: string, kind: InspectionKind): UploadedPhoto[] | null {
  let parsed: unknown = [];
  try {
    parsed = raw ? JSON.parse(String(raw)) : [];
  } catch {
    return null;
  }
  const result = photoSchema.safeParse(parsed);
  if (!result.success) return null;
  const prefix = `${reservationId}/${kind.toLowerCase()}/`;
  return result.data.every((photo) => photo.path.startsWith(prefix) && /^[0-9a-f-]{36}\.(jpg|png|webp|heic|heif)$/.test(photo.path.slice(prefix.length))) ? result.data : null;
}

export async function createPhotoUploads(reservationId: string, kind: InspectionKind, files: Array<{ type: string; size: number }>): Promise<UploadTarget[]> {
  const session = await requirePermission("vehicle.inspect");
  if (!uuid.safeParse(reservationId).success || files.length > maxPhotos) return files.map(() => null);
  if (!(await scopeAllows(session, { reservation: reservationId }))) return files.map(() => null);
  const storage = createAdminClient().storage.from(photoBucket);
  const targets: UploadTarget[] = [];
  for (const file of files) {
    if (!imageType.test(file.type) || file.size > maxPhotoBytes) {
      targets.push(null);
      continue;
    }
    const ext = file.type.split("/")[1].replace("jpeg", "jpg");
    const path = `${reservationId}/${kind.toLowerCase()}/${randomUUID()}.${ext}`;
    const { data } = await storage.createSignedUploadUrl(path);
    targets.push(data ? { path, url: data.signedUrl } : null);
  }
  return targets;
}

async function insertInspection(input: {
  reservationId: string;
  vehicleId: string;
  kind: InspectionKind;
  odometer: number;
  batteryLevel: number;
  accessories: Record<string, boolean>;
  checklist: Record<string, unknown>;
  charges: unknown[];
  damageNotes: string;
  renterRemarks: string;
  photos: UploadedPhoto[];
  performedBy: string;
}) {
  const supabase = createAdminClient();
  const values = {
    odometer: input.odometer,
    battery_level: input.batteryLevel,
    accessories: input.accessories,
    checklist: input.checklist,
    charges: input.charges,
    damage_notes: input.damageNotes || null,
    renter_remarks: input.renterRemarks || null,
    performed_by: input.performedBy,
  };
  const { data: earlier } = await supabase.from("inspections").select("id").eq("reservation_id", input.reservationId).eq("kind", input.kind).maybeSingle();
  const { data, error } = earlier
    ? await supabase.from("inspections").update(values).eq("id", earlier.id).select("id").single()
    : await supabase.from("inspections").insert({ reservation_id: input.reservationId, vehicle_id: input.vehicleId, kind: input.kind, ...values }).select("id").single();
  if (error || !data) return null;
  if (input.photos.length) {
    await supabase.from("inspection_photos").insert(input.photos.map((photo) => ({ inspection_id: data.id, storage_path: photo.path, mime_type: photo.type, size_bytes: photo.size })));
  }
  return { id: data.id as string, resumed: Boolean(earlier) };
}

type PickupGate = { assigned_vehicle_id: string; agreement_state: string; verification_state: string; drivers_pending: number | null; protection: string; insurance_state: string; customer: unknown };

async function pickupBlocker(reservation: PickupGate) {
  if ((await vehiclePhotoProgress(reservation.assigned_vehicle_id)).missing.length) return "vehicle_photos";
  if (reservation.agreement_state !== "SIGNED") return "agreement_required";
  if (reservation.verification_state !== "VERIFIED") return "license_required";
  if ((reservation.drivers_pending ?? 0) > 0) return "drivers_required";
  if (!protectionAllowed(reservation.protection, (reservation.customer as { license_kind: string | null } | null)?.license_kind)) return "protection_required";
  if (!insuranceOk(reservation.insurance_state)) return "insurance_required";
  return null;
}

const holdDue = (reservation: { security_hold_cents: number | null; quote_snapshot: unknown }) => (reservation.security_hold_cents ?? 0) + ((reservation.quote_snapshot as { depositCents?: number } | null)?.depositCents ?? 0);

const pickupInput = z.object({
  reservationId: uuid,
  odometer: z.coerce.number().int().min(0).max(2000000),
  batteryLevel: z.coerce.number().int().min(0).max(100),
  damageNotes: z.string().trim().max(2000),
  renterRemarks: z.string().trim().max(2000),
});

export async function completePickup(_: HandoverState, form: FormData): Promise<HandoverState> {
  const session = await requirePermission("vehicle.inspect");
  const parsed = pickupInput.safeParse({
    reservationId: form.get("reservationId"),
    odometer: form.get("odometer"),
    batteryLevel: form.get("batteryLevel"),
    damageNotes: form.get("damageNotes") ?? "",
    renterRemarks: form.get("renterRemarks") ?? "",
  });
  if (!parsed.success) return { error: "invalid" };
  await requireScope(session, { reservation: parsed.data.reservationId });
  const { reservationId, odometer, batteryLevel, damageNotes, renterRemarks } = parsed.data;
  const photos = parsePhotos(form.get("photos"), reservationId, "PICKUP");
  const videos = parseVideos(form.get("videos"), reservationId, "PICKUP");
  if (!photos || !videos) return { error: "invalid" };
  if (missingRequests(form).length) return { error: "requests_required" };
  if (!bool(form.get("chk_access"))) return { error: "access_required" };
  const accessAccount = String(form.get("accessAccount") ?? "").trim().slice(0, 120);

  const supabase = createAdminClient();
  const { data: reservation } = await supabase
    .from("reservations")
    .select("id, number, status, pickup_at, assigned_vehicle_id, verification_state, agreement_state, hold_state, security_hold_cents, quote_snapshot, add_ons, drivers_pending, insurance_state, protection, customer:customers(license_kind)")
    .eq("id", reservationId)
    .maybeSingle();
  if (!reservation) return { error: "not_found" };
  if (reservation.status !== "CONFIRMED") return { error: "invalid_transition" };
  if (Date.parse(reservation.pickup_at) - Date.now() > 24 * 3600000 && !bool(form.get("allowEarly"))) return { error: "early_pickup" };
  if (!reservation.assigned_vehicle_id) return { error: "vehicle_required" };
  const blocker = await pickupBlocker({ ...reservation, assigned_vehicle_id: reservation.assigned_vehicle_id });
  if (blocker) return { error: blocker };
  if (!bool(form.get("chk_fsd")) || !bool(form.get("chk_returnRules"))) return { error: "briefing_required" };

  const record = (action: string, metadata: Record<string, unknown>) =>
    audit({ actorUserId: session.userId, actorType: "STAFF", action, entityType: "reservation", entityId: reservationId, metadata: { by: session.displayName, number: reservation.number, ...metadata } });

  const stop = (state: HandoverState): HandoverState => {
    revalidatePath("/ops", "layout");
    return state;
  };

  let hold: "placed" | "existing" | "waived" = "existing";
  const holdNote = String(form.get("holdNote") ?? "").trim().slice(0, 120);
  if (reservation.hold_state !== "AUTHORIZED" && holdDue(reservation) > 0) {
    if (bool(form.get("allowNoHold")) && session.permissions.has("handover.no_hold")) {
      hold = "waived";
    } else {
      if (!stripeConfigured()) return { error: "stripe_not_configured", holdFailed: true };
      try {
        const placed = await placeSecurityHold(reservationId, session.userId);
        await record("security_hold.authorized", { paymentId: placed.paymentId, status: placed.status });
        hold = "placed";
      } catch (cause) {
        const code = cause instanceof PaymentError ? cause.code : "hold_failed";
        await record("payment.action_failed", { intent: "hold", code });
        return stop({ error: code, holdFailed: true });
      }
    }
  }

  if (reservation.verification_state !== "VERIFIED") {
    await supabase.from("reservations").update({ verification_state: "VERIFIED" }).eq("id", reservationId);
    await record("reservation.verification_marked", { value: "VERIFIED", inPerson: true });
  }

  const collection = await collectBalanceAtStart(reservationId, session.userId);
  if (collection.outstandingCents > 0 && collection.chargedCents < collection.outstandingCents) {
    const override = bool(form.get("allowUnpaid")) && session.permissions.has("handover.override");
    if (!override) return stop({ error: collection.error ?? "balance_uncollected", hold, collection, holdFailed: hold === "waived" });
    await record("payment.balance_waived_at_pickup", { outstandingCents: collection.outstandingCents, code: collection.error ?? null });
  }

  const pickupInspection = await insertInspection({
    reservationId,
    vehicleId: reservation.assigned_vehicle_id,
    kind: "PICKUP",
    odometer,
    batteryLevel,
    accessories: { keyCard: bool(form.get("acc_keyCard")), charger: bool(form.get("acc_charger")), childSeat: bool(form.get("acc_childSeat")) },
    checklist: {
      license: reservation.verification_state === "VERIFIED" ? "online" : "in_person",
      fsdBriefing: true,
      returnRules: true,
      requests: String(form.get("requestIds") ?? "").split("|").filter((id) => requestId.test(id)),
      access: { granted: true, account: accessAccount || null },
      ...(hold === "waived" ? { hold: { waived: true, note: holdNote || null } } : {}),
    },
    charges: [],
    damageNotes,
    renterRemarks,
    photos,
    performedBy: session.userId,
  });
  if (!pickupInspection) return stop({ error: "failed", hold });
  const inspectionId = pickupInspection.id;
  await storeVideos({ videos, reservationId, vehicleId: reservation.assigned_vehicle_id, inspectionId, kind: "PICKUP", userId: session.userId });

  const { error } = await supabase.rpc("set_reservation_status", { p_reservation_id: reservationId, p_status: "ACTIVE", p_reason: null });
  if (error) return stop({ error: error.message.includes("vehicle_required") ? "vehicle_required" : error.message.includes("vehicle_busy") ? "vehicle_busy" : "invalid_transition", hold, collection });
  await Promise.all([
    supabase.from("reservations").update({ start_odometer: odometer }).eq("id", reservationId),
    supabase.from("vehicles").update({ odometer, battery_level: batteryLevel }).eq("id", reservation.assigned_vehicle_id),
    recordReading({ vehicleId: reservation.assigned_vehicle_id, reading: odometer, source: "PICKUP", reservationId, createdBy: session.userId }).catch(() => null),
  ]);
  await record("reservation.status_changed", { from: "CONFIRMED", to: "ACTIVE" });
  if (hold === "waived") await record("security_hold.waived_at_pickup", { note: holdNote || null });
  await record("reservation.pickup_completed", { inspectionId, odometer, batteryLevel, photos: photos.length, hold, collection });
  revalidatePath("/ops", "layout");
  redirect(`/reservations/${reservationId}/rate?stage=pickup`);
}

const payInput = z.object({ reservationId: uuid, intent: z.enum(["hold", "charge", "link"]) });

export async function pickupPayment(_: PickupPayState, form: FormData): Promise<PickupPayState> {
  const session = await requirePermission("vehicle.inspect");
  const parsed = payInput.safeParse({ reservationId: form.get("reservationId"), intent: form.get("intent") });
  if (!parsed.success) return { error: "invalid" };
  const { reservationId, intent } = parsed.data;
  await requireScope(session, { reservation: reservationId });

  const { data: reservation } = await createAdminClient()
    .from("reservations")
    .select("id, number, status, pickup_at, assigned_vehicle_id, verification_state, agreement_state, hold_state, security_hold_cents, quote_snapshot, drivers_pending, insurance_state, protection, customer:customers(license_kind)")
    .eq("id", reservationId)
    .maybeSingle();
  if (!reservation) return { intent, error: "not_found" };
  if (reservation.status !== "CONFIRMED") return { intent, error: "invalid_transition" };

  const record = (action: string, metadata: Record<string, unknown>) =>
    audit({ actorUserId: session.userId, actorType: "STAFF", action, entityType: "reservation", entityId: reservationId, metadata: { by: session.displayName, number: reservation.number, at: "pickup", ...metadata } });
  const done = (result: PickupPayState): PickupPayState => {
    revalidatePath("/ops", "layout");
    return { intent, ...result };
  };

  const early = Date.parse(reservation.pickup_at) - Date.now() > 24 * 3600000;
  if (intent === "link") {
    if (early && !session.permissions.has("payment.capture")) return { intent, error: "early_payment" };
    if (!stripeConfigured()) return { intent, error: "stripe_not_configured" };
    if (!(await payLinkRecipient(reservationId))) return { intent, error: "no_email" };
    try {
      const checkout = await createCheckout(reservationId, { createdBy: session.userId, holdMinutes: 24 * 60 - 5, minLeftMinutes: 12 * 60 });
      const mail = await sendPayLinkEmail(reservationId, checkout);
      if (!mail.sent) {
        await record("payment.link_created", { paymentId: checkout.paymentId, email: mail.reason });
        return done({ error: mail.reason });
      }
      await record("payment.link_emailed", { paymentId: checkout.paymentId, to: mail.to });
      return done({ ok: true, sentTo: mail.to });
    } catch (cause) {
      if (!(cause instanceof PaymentError)) throw cause;
      await record("payment.action_failed", { intent: "checkout_email", code: cause.code });
      return done({ error: cause.code });
    }
  }

  if (early) return { intent, error: "early_payment" };
  if (!reservation.assigned_vehicle_id) return { intent, error: "vehicle_required" };
  const blocker = await pickupBlocker({ ...reservation, assigned_vehicle_id: reservation.assigned_vehicle_id });
  if (blocker) return { intent, error: blocker };

  if (intent === "hold") {
    if (reservation.hold_state === "AUTHORIZED" || holdDue(reservation) <= 0) return done({ ok: true });
    if (!stripeConfigured()) return { intent, error: "stripe_not_configured" };
    try {
      const placed = await placeSecurityHold(reservationId, session.userId);
      await record("security_hold.authorized", { paymentId: placed.paymentId, status: placed.status });
      return done({ ok: true });
    } catch (cause) {
      const code = cause instanceof PaymentError ? cause.code : "hold_failed";
      await record("payment.action_failed", { intent: "hold", code });
      return done({ error: code });
    }
  }

  const collection = await collectBalanceAtStart(reservationId, session.userId);
  if (collection.outstandingCents > collection.chargedCents) return done({ error: collection.error ?? "balance_uncollected" });
  return done({ ok: true });
}

const returnInput = pickupInput.extend({
  damageCents: dollars,
  cleaningCents: dollars,
  otherLabel: z.string().trim().max(120),
  otherCents: dollars,
  returnedAt: z.string().trim().max(40),
});

const feeDescriptions: Record<string, string> = {
  excess_mileage: "Excess mileage",
  low_charge: "Recharge below return target",
  late_hours: "Late return (hourly)",
  late_return: "Late return",
  supercharging: "Supercharging",
  cleaning: "Cleaning",
  other: "Other post-rental charge",
};

const returnFeeCodes = [...Object.keys(feeDescriptions), "tax"].map((code) => `fee.${code}`);

export async function completeReturn(_: HandoverState, form: FormData): Promise<HandoverState> {
  const session = await requirePermission("vehicle.inspect");
  const parsed = returnInput.safeParse({
    reservationId: form.get("reservationId"),
    odometer: form.get("odometer"),
    batteryLevel: form.get("batteryLevel"),
    damageNotes: form.get("damageNotes") ?? "",
    renterRemarks: form.get("renterRemarks") ?? "",
    damageCents: form.get("damageCents") ?? "",
    cleaningCents: form.get("cleaningCents") ?? "",
    otherLabel: form.get("otherLabel") ?? "",
    otherCents: form.get("otherCents") ?? "",
    returnedAt: form.get("returnedAt") ?? "",
  });
  if (!parsed.success) return { error: "invalid" };
  await requireScope(session, { reservation: parsed.data.reservationId });
  const { reservationId, odometer, batteryLevel, damageNotes, renterRemarks, damageCents, cleaningCents, otherLabel, otherCents, returnedAt } = parsed.data;
  const photos = parsePhotos(form.get("photos"), reservationId, "RETURN");
  const videos = parseVideos(form.get("videos"), reservationId, "RETURN");
  if (!photos || !videos) return { error: "invalid" };
  if (!bool(form.get("chk_accessRevoked"))) return { error: "access_revoke_required" };
  if (String(form.get("damageOnsite") ?? "") === "pending") return { error: "damage_confirm_pending" };

  const supabase = createAdminClient();
  const { data: reservation } = await supabase.from("reservations").select("id, number, status, assigned_vehicle_id, customer_id, start_odometer, actual_pickup_at").eq("id", reservationId).maybeSingle();
  if (!reservation) return { error: "not_found" };
  if (reservation.status !== "ACTIVE" || !reservation.assigned_vehicle_id) return { error: "invalid_transition" };
  if (typeof reservation.start_odometer === "number" && odometer < reservation.start_odometer) return { error: "odometer_low" };
  const params = await loadReturnParams(reservationId);
  if (!params) return { error: "not_found" };
  const submittedAt = Date.now();
  const wall = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})$/.exec(returnedAt);
  if (returnedAt && !wall) return { error: "return_time_invalid" };
  const claimedAt = wall ? zonedToUtc(wall[1], wall[2], params.timeZone).getTime() : submittedAt;
  if (!Number.isFinite(claimedAt) || claimedAt > submittedAt + 5 * 60000 || (reservation.actual_pickup_at && claimedAt < Date.parse(reservation.actual_pickup_at))) return { error: "return_time_invalid" };
  const tollPending = !params.tollIncluded && bool(form.get("tollPending"));
  if (tollPending) await supabase.from("reservations").update({ toll_pending: true }).eq("id", reservationId);

  const record = (action: string, metadata: Record<string, unknown>) =>
    audit({ actorUserId: session.userId, actorType: "STAFF", action, entityType: "reservation", entityId: reservationId, metadata: { by: session.displayName, number: reservation.number, ...metadata } });

  const actualReturnAt = new Date(Math.min(claimedAt, submittedAt)).toISOString();
  const lookup = params.vin ? await superchargingFor(reservationId, actualReturnAt).then((value) => ({ value }), () => null) : { value: null };
  const chargingUnknown = lookup === null;
  const { data: earlierLines } = await supabase.from("reservation_line_items").select("code, quantity, unit_cents, amount_cents").eq("reservation_id", reservationId).eq("type", "ADDITIONAL").in("code", returnFeeCodes);
  const settled = (earlierLines ?? []).length > 0;
  const fees: FeeLine[] = settled
    ? (earlierLines ?? []).filter((line) => line.code !== "fee.tax").map((line) => ({ code: line.code.slice(4) as FeeLine["code"], quantity: Number(line.quantity), unitCents: line.unit_cents, amountCents: line.amount_cents }))
    : computeReturnFees({ ...params, superchargingCents: lookup?.value?.cents ?? 0, endOdometer: odometer, batteryLevel, actualReturnAt, cleaningCents, otherCents });
  const feeTaxCents = settled ? (earlierLines ?? []).filter((line) => line.code === "fee.tax").reduce((sum, line) => sum + line.amount_cents, 0) : params.returnFeesTaxable ? taxAt(feeTotal(fees), params.taxRateBps) : 0;
  const total = feeTotal(fees) + feeTaxCents;
  const charges: unknown[] = [...fees];
  const prior = (await listClaims(reservationId)).filter((row) => row.status !== "CLOSED");
  const signedBefore = prior.filter(signedOnsite);
  const damageShown = signedBefore.length ? signedBefore.reduce((sum, row) => sum + row.amount_cents, 0) : damageCents;
  if (damageShown > 0) charges.push({ code: "damage", amountCents: damageShown, pendingConsent: !signedBefore.length });

  const returnInspection = await insertInspection({
    reservationId,
    vehicleId: reservation.assigned_vehicle_id,
    kind: "RETURN",
    odometer,
    batteryLevel,
    accessories: { keyCard: bool(form.get("acc_keyCard")), charger: bool(form.get("acc_charger")), childSeat: bool(form.get("acc_childSeat")) },
    checklist: { cleaning: cleaningCents > 0 ? "charged" : "ok", other: otherLabel || undefined, toll: tollPending ? "pending" : undefined, access: { revoked: true } },
    charges,
    damageNotes,
    renterRemarks,
    photos,
    performedBy: session.userId,
  });
  if (!returnInspection) return { error: "failed" };
  const inspectionId = returnInspection.id;
  await storeVideos({ videos, reservationId, vehicleId: reservation.assigned_vehicle_id, inspectionId, kind: "RETURN", userId: session.userId });
  const actor = { userId: session.userId, displayName: session.displayName };
  let claim: ClaimRow | null = prior.find((row) => row.status === "CONSENTED" && row.consent_method === "ONSITE") ?? null;
  if (!claim && damageCents > 0 && !prior.length) claim = await createDamageClaim({ reservationId, inspectionId, customerId: reservation.customer_id, amountCents: damageCents, description: damageNotes, createdBy: session.userId, createdByName: session.displayName }).catch(() => null);
  if (prior.length) await supabase.from("damage_claims").update({ inspection_id: inspectionId }).eq("reservation_id", reservationId).is("inspection_id", null);
  const damageDue = claim?.status === "CONSENTED" && claim.consent_method === "ONSITE" ? claim.amount_cents : 0;

  if (fees.length && !settled) {
    await supabase.from("reservation_line_items").insert(
      fees.map((fee, index) => ({
        reservation_id: reservationId,
        type: "ADDITIONAL",
        code: `fee.${fee.code}`,
        description: fee.code === "other" && otherLabel ? otherLabel : feeDescriptions[fee.code],
        quantity: fee.quantity,
        unit_cents: fee.unitCents,
        amount_cents: fee.amountCents,
        taxable: params.returnFeesTaxable,
        sort_order: 100 + index,
      })),
    );
    if (feeTaxCents > 0) {
      await supabase.from("reservation_line_items").insert({ reservation_id: reservationId, type: "ADDITIONAL", code: "fee.tax", description: "Sales tax on post-rental charges", quantity: 1, unit_cents: feeTaxCents, amount_cents: feeTaxCents, taxable: false, sort_order: 199 });
    }
  }

  await revokeForReservation(reservationId).catch(() => undefined);
  let chargedCents = 0;
  if (settled) {
    const { data: prior } = await supabase.from("payments").select("amount_captured_cents").eq("reservation_id", reservationId).eq("kind", "ADDITIONAL").eq("status", "SUCCEEDED").eq("description", `Post-rental charges ${reservation.number}`);
    chargedCents = Math.min(total, (prior ?? []).reduce((sum, row) => sum + row.amount_captured_cents, 0));
  }
  let capturedCents = 0;
  if (settled) {
    const { data: taken } = await supabase.from("payments").select("amount_captured_cents").eq("reservation_id", reservationId).eq("kind", "SECURITY_HOLD").gt("amount_captured_cents", 0);
    capturedCents = Math.min(total - chargedCents, (taken ?? []).reduce((sum, row) => sum + row.amount_captured_cents, 0));
  }
  let released = false;
  let paymentError: string | undefined;
  let damageChargedCents = 0;
  let damageCapturedCents = 0;
  const { data: holdRow } = await supabase.from("payments").select("id, amount_cents").eq("reservation_id", reservationId).eq("kind", "SECURITY_HOLD").eq("status", "AUTHORIZED").limit(1).maybeSingle();
  if (!stripeConfigured()) {
    if (total > 0 || holdRow || damageDue > 0) paymentError = "stripe_not_configured";
  } else {
    let feesToCapture = 0;
    if (total > 0 && !settled) {
      try {
        const charge = await chargeSavedCard(reservationId, { amountCents: total, description: `Post-rental charges ${reservation.number}`, kind: "ADDITIONAL", createdBy: session.userId });
        chargedCents = total;
        await record("payment.charged", { paymentId: charge.paymentId, amountCents: total, kind: "ADDITIONAL", fees });
      } catch (cause) {
        paymentError = cause instanceof PaymentError ? cause.code : "failed";
        await record("payment.action_failed", { intent: "charge", code: paymentError });
        feesToCapture = total;
      }
    }
    if (claim && damageDue > 0) {
      const charged = await chargeClaim(claim, { ...actor, type: "STAFF" });
      if (charged.ok) damageChargedCents = damageDue;
      else paymentError ??= charged.error;
    }
    const wanted = feesToCapture + damageDue - damageChargedCents;
    if (holdRow && wanted > 0) {
      const amount = Math.min(wanted, holdRow.amount_cents);
      try {
        await captureHold(holdRow.id, amount);
        capturedCents = Math.min(feesToCapture, amount);
        damageCapturedCents = amount - capturedCents;
        await record("security_hold.captured", { paymentId: holdRow.id, amountCents: amount, note: "post-rental charges", feeCents: capturedCents, damageCents: damageCapturedCents });
        if (claim && damageCapturedCents > 0) await settleClaimFromHold(claim, holdRow.id, damageCapturedCents, actor);
      } catch (captureCause) {
        paymentError = captureCause instanceof PaymentError ? captureCause.code : "failed";
      }
    }
  }
  const signed = damageCents > 0 || prior.length ? await onsiteDamage(reservationId) : { consented: false, totalCents: 0, chargedCents: 0, capturedCents: 0, uncollectedCents: 0 };
  if (stripeConfigured() && holdRow && capturedCents === 0 && damageCapturedCents === 0 && chargedCents >= total && signed.uncollectedCents === 0) {
    try {
      await releaseHold(holdRow.id);
      released = true;
      await record("security_hold.released", { paymentId: holdRow.id });
    } catch (cause) {
      paymentError ??= cause instanceof PaymentError ? cause.code : "failed";
    }
  }
  const uncollectedCents = Math.max(0, total - chargedCents - capturedCents);
  const damageOwedCents = signed.uncollectedCents;
  const damage = damageCents > 0 || signed.consented ? { consented: signed.consented, chargedCents: signed.chargedCents, capturedCents: signed.capturedCents, uncollectedCents: signed.uncollectedCents } : undefined;

  const { error } = await supabase.rpc("set_reservation_status", { p_reservation_id: reservationId, p_status: "COMPLETED", p_reason: null });
  if (error) return { error: "invalid_transition", fees, chargedCents, capturedCents, uncollectedCents, released, paymentError };
  const cleanState = cleaningCents > 0 ? (batteryLevel < params.minReturnLevel ? "NEEDS_BOTH" : "NEEDS_CLEANING") : batteryLevel < params.minReturnLevel ? "NEEDS_CHARGING" : "READY";
  await Promise.all([
    supabase.from("reservations").update({ end_odometer: odometer, actual_return_at: actualReturnAt }).eq("id", reservationId),
    supabase.from("vehicles").update({ odometer, battery_level: batteryLevel, clean_state: cleanState }).eq("id", reservation.assigned_vehicle_id),
    recordReading({ vehicleId: reservation.assigned_vehicle_id, reading: odometer, source: "RETURN", reservationId, readAt: actualReturnAt, createdBy: session.userId }).catch(() => null),
  ]);
  await record("reservation.status_changed", { from: "ACTIVE", to: "COMPLETED" });
  await postRentalShare(reservationId).catch((cause) => console.error("[investor:share]", cause instanceof Error ? cause.message : cause));
  await openPrepTask(reservation.assigned_vehicle_id, reservationId, session.userId).catch(() => null);
  await record("reservation.return_completed", { inspectionId, odometer, batteryLevel, photos: photos.length, fees, damageCents, damage, chargedCents, capturedCents, uncollectedCents, released, paymentError, actualReturnAt, chargingUnknown, resumed: returnInspection.resumed });
  await notifyReturnSettlement(reservationId, { fees: fees.map((fee) => ({ code: fee.code, amountCents: fee.amountCents, label: fee.code === "other" && otherLabel ? otherLabel : undefined })), taxCents: feeTaxCents, chargedCents, capturedCents, uncollectedCents, released, damageCents: signed.consented ? signed.totalCents : damageCents, damage, tollPending }).catch(() => undefined);
  await sendTripSurvey(reservationId).catch(() => undefined);
  revalidatePath("/ops", "layout");
  redirect(`/reservations/${reservationId}/rate?stage=return${uncollectedCents > 0 ? `&owed=${uncollectedCents}` : ""}${chargingUnknown ? "&charging=unknown" : ""}${damageOwedCents > 0 ? `&damage=${damageOwedCents}` : ""}`);
}

export async function confirmDamageOnsite(_: DamageConfirmState, form: FormData): Promise<DamageConfirmState> {
  const session = await requirePermission("vehicle.inspect");
  const parsed = z.object({ reservationId: uuid, damageCents: dollars }).safeParse({ reservationId: form.get("reservationId"), damageCents: form.get("damageCents") ?? "" });
  if (!parsed.success || parsed.data.damageCents <= 0) return { error: "invalid" };
  const { reservationId, damageCents } = parsed.data;
  const notes = String(form.get("damageNotes") ?? "").trim().slice(0, 2000);
  if (notes.length < 3) return { error: "damage_notes_required" };
  const signer = String(form.get("damageSigner") ?? "").trim().slice(0, 120);
  const signature = signatureImageInput.safeParse(form.get("signature"));
  if (!signature.success || signer.length < 2 || String(form.get("consentMark") ?? "") !== onsiteConsentText(damageCents, notes).en) return { error: "signatureInvalid" };
  await requireScope(session, { reservation: reservationId });

  const { data: reservation } = await createAdminClient().from("reservations").select("number, status, customer_id").eq("id", reservationId).maybeSingle();
  if (!reservation?.customer_id || reservation.status !== "ACTIVE") return { error: "invalid_transition" };
  const actor = { userId: session.userId, displayName: session.displayName };
  const prior = (await listClaims(reservationId)).filter((row) => row.status !== "CLOSED");
  const signed = prior.filter(signedOnsite);
  let claim: ClaimRow | null = signed.find((row) => row.status === "CONSENTED") ?? null;
  if (!claim && signed.length) return { ok: true, charged: true, amountCents: signed.reduce((sum, row) => sum + row.amount_cents, 0) };
  if (!claim) {
    const head = await headers();
    const consent = { name: signer, signature: signature.data, ip: clientIpFrom(head), userAgent: head.get("user-agent")?.slice(0, 400) ?? null };
    const waiting = prior.find((row) => row.status === "PENDING_CONSENT") ?? null;
    claim = waiting
      ? await consentClaimOnsite(waiting, { amountCents: damageCents, description: notes, consent, actor })
      : await createDamageClaim({ reservationId, inspectionId: null, customerId: reservation.customer_id, amountCents: damageCents, description: notes, createdBy: session.userId, createdByName: session.displayName, consent }).catch(() => null);
  }
  if (!claim) return { error: "failed" };

  const charged = stripeConfigured() ? await chargeClaim(claim, { ...actor, type: "STAFF" }) : { ok: false as const, error: "stripe_not_configured" };
  const amount = formatMoney(claim.amount_cents);
  await notifyStaff({ kind: "damage.onsite", reservationId, locationId: null, href: `/reservations/${reservationId}`, dedupeKey: `damage-onsite:${claim.id}`, params: { number: reservation.number, amount, by: session.displayName } });
  await notifyOpsEmail(`现场确认车损 / Damage signed on site · ${reservation.number} · ${amount}`, [
    `${reservation.number} · ${amount} · ${session.displayName}`,
    charged.ok ? "已从卡上扣款 / charged to the card" : `卡没扣到（${charged.error}），完成还车时再从卡或押金收取 / the card was not charged, it is collected when the return is completed`,
    `${opsOrigin}/reservations/${reservationId}`,
  ]);
  revalidatePath("/ops", "layout");
  return { ok: true, charged: charged.ok, amountCents: claim.amount_cents, failure: charged.ok ? undefined : charged.error };
}

const signInput = z.object({
  reservationId: uuid,
  signerName: z.string().trim().min(2).max(120).regex(/^\P{Cc}+$/u),
  initials: z.string().trim().regex(/^\p{L}{1,6}$/u),
  waiverAck: z.literal("on"),
  locationAck: z.literal("on"),
  longTermAck: z.string().optional(),
  electronicComms: z.string().optional(),
  agree: z.literal("on"),
});

export async function signOnDevice(_: HandoverState, form: FormData): Promise<HandoverState> {
  const session = await requirePermission("vehicle.inspect");
  const parsed = signInput.safeParse({
    reservationId: form.get("reservationId"),
    signerName: form.get("signerName"),
    initials: form.get("initials"),
    waiverAck: form.get("waiverAck"),
    locationAck: form.get("locationAck"),
    longTermAck: form.get("longTermAck") ?? undefined,
    electronicComms: form.get("electronicComms") ?? undefined,
    agree: form.get("agree"),
  });
  if (!parsed.success) return { error: "invalid" };
  await requireScope(session, { reservation: parsed.data.reservationId });
  const signature = signatureImageInput.safeParse(form.get("signature"));
  if (!signature.success) return { error: "signatureInvalid" };
  const { reservationId } = parsed.data;

  const supabase = createAdminClient();
  const { data: reservation } = await supabase.from("reservations").select("id, number, status, customer_id, agreement_state").eq("id", reservationId).maybeSingle();
  if (!reservation) return { error: "not_found" };
  if (["CANCELLED", "NO_SHOW", "EXPIRED", "COMPLETED"].includes(reservation.status)) return { error: "invalid_transition" };
  if (reservation.agreement_state === "SIGNED") redirect(`/reservations/${reservationId}/pickup`);

  const picked = String(form.get("lang") ?? "");
  const locale = isLocale(picked) ? picked : await getLocale();
  const facts = await loadAgreementFacts(reservationId, locale);
  if (!facts) return { error: "failed" };
  if (!protectionAllowed(facts.waiver.tier, facts.licenseKind)) return { error: "protection_required" };
  if (String(form.get("termsMark") ?? "") !== renderAgreement(locale, facts, undefined, false, "device").hash) return { error: "agreement_changed" };
  const longTerm = isLongTerm(facts.rentalDays);
  if (longTerm && parsed.data.longTermAck !== "on") return { error: "invalid" };
  const electronic = parsed.data.electronicComms === "on";
  const elections: Elections = {
    waiverTier: facts.waiver.tier,
    waiverInitials: parsed.data.initials,
    locationInitials: parsed.data.initials,
    electronicComms: electronic,
    electronicInitials: electronic ? parsed.data.initials : null,
    longTermInitials: longTerm ? parsed.data.initials : null,
  };
  const signedAt = new Date().toISOString();
  const rendered = renderAgreement(locale, facts, { signerName: parsed.data.signerName, signedAt, elections }, false, "device");
  const head = await headers();
  const saved = await recordSignature(reservationId, facts.seenAt, {
    templateVersion: agreementVersion,
    locale,
    text: rendered.text,
    hash: rendered.hash,
    signerName: parsed.data.signerName,
    signerIp: clientIpFrom(head),
    userAgent: head.get("user-agent")?.slice(0, 400) ?? null,
    signedAt,
    elections,
    signatureImage: signature.data,
  });
  if (saved.outcome === "already") redirect(`/reservations/${reservationId}/pickup`);
  if (saved.outcome !== "signed") return { error: saved.outcome === "changed" ? "agreement_changed" : "failed" };
  const version = saved.version ?? 1;
  await audit({
    actorUserId: session.userId,
    actorType: "STAFF",
    action: "reservation.agreement_signed",
    entityType: "reservation",
    entityId: reservationId,
    metadata: { by: parsed.data.signerName, witnessedBy: session.displayName, number: reservation.number, version: agreementVersion, revision: version, locale, hash: rendered.hash, elections, onDevice: true },
  });
  revalidatePath("/ops", "layout");
  redirect(`/reservations/${reservationId}/pickup`);
}
