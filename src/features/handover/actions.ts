"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getLocale } from "next-intl/server";
import { z } from "zod";
import { collectBalanceAtStart } from "@/features/payments/cancel-settlement";
import { captureHold, chargeSavedCard, PaymentError, placeSecurityHold, releaseHold } from "@/features/payments/service";
import { agreementVersion, isLongTerm, renderAgreement, signatureImageInput, type Elections } from "@/features/portal/agreement";
import { loadAgreementFacts } from "@/features/portal/agreement-facts";
import { sendTripSurvey } from "@/features/ratings/survey";
import { audit } from "@/lib/audit";
import { clientIpFrom } from "@/lib/auth/client-ip";
import { requirePermission } from "@/lib/auth/staff";
import { stripeConfigured } from "@/lib/stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { computeReturnFees, feeTotal, lateNotices } from "./fees";
import { loadReturnParams } from "./queries";
import { maxPhotoBytes, maxPhotos, photoBucket, type HandoverState, type InspectionKind, type UploadTarget, type UploadedPhoto } from "./types";

const uuid = z.uuid();
const imageType = /^image\/(jpeg|png|webp|heic|heif)$/;
const bool = (value: FormDataEntryValue | null) => value === "on";
const dollars = z
  .string()
  .trim()
  .regex(/^(\d{1,6}(\.\d{1,2})?)?$/)
  .transform((value) => (value ? Math.round(Number(value) * 100) : 0));
const photoSchema = z.array(z.object({ path: z.string().max(200), type: z.string().regex(imageType), size: z.number().int().min(0).max(maxPhotoBytes) })).max(maxPhotos);

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
  await requirePermission("vehicle.inspect");
  if (!uuid.safeParse(reservationId).success || files.length > maxPhotos) return files.map(() => null);
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
  const { data, error } = await supabase
    .from("inspections")
    .insert({
      reservation_id: input.reservationId,
      vehicle_id: input.vehicleId,
      kind: input.kind,
      odometer: input.odometer,
      battery_level: input.batteryLevel,
      accessories: input.accessories,
      checklist: input.checklist,
      charges: input.charges,
      damage_notes: input.damageNotes || null,
      renter_remarks: input.renterRemarks || null,
      performed_by: input.performedBy,
    })
    .select("id")
    .single();
  if (error || !data) return null;
  if (input.photos.length) {
    await supabase.from("inspection_photos").insert(input.photos.map((photo) => ({ inspection_id: data.id, storage_path: photo.path, mime_type: photo.type, size_bytes: photo.size })));
  }
  return data.id as string;
}

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
  const { reservationId, odometer, batteryLevel, damageNotes, renterRemarks } = parsed.data;
  const photos = parsePhotos(form.get("photos"), reservationId, "PICKUP");
  if (!photos) return { error: "invalid" };

  const supabase = createAdminClient();
  const { data: reservation } = await supabase
    .from("reservations")
    .select("id, number, status, assigned_vehicle_id, verification_state, agreement_state, hold_state, add_ons")
    .eq("id", reservationId)
    .maybeSingle();
  if (!reservation) return { error: "not_found" };
  if (reservation.status !== "CONFIRMED") return { error: "invalid_transition" };
  if (!reservation.assigned_vehicle_id) return { error: "vehicle_required" };
  if (reservation.agreement_state !== "SIGNED") return { error: "agreement_required" };
  const licenseInPerson = bool(form.get("chk_license"));
  if (reservation.verification_state !== "VERIFIED" && !licenseInPerson) return { error: "license_required" };
  if (!bool(form.get("chk_fsd")) || !bool(form.get("chk_returnRules"))) return { error: "briefing_required" };
  const extraDriver = reservation.add_ons.includes("driver");
  if (extraDriver && !bool(form.get("chk_extraDriver"))) return { error: "extra_driver_required" };

  const record = (action: string, metadata: Record<string, unknown>) =>
    audit({ actorUserId: session.userId, actorType: "STAFF", action, entityType: "reservation", entityId: reservationId, metadata: { by: session.displayName, number: reservation.number, ...metadata } });

  let hold: "placed" | "existing" = "existing";
  if (reservation.hold_state !== "AUTHORIZED") {
    if (!stripeConfigured()) return { error: "stripe_not_configured" };
    try {
      const placed = await placeSecurityHold(reservationId, session.userId);
      await record("security_hold.authorized", { paymentId: placed.paymentId, status: placed.status });
      hold = "placed";
    } catch (cause) {
      const code = cause instanceof PaymentError ? cause.code : "hold_failed";
      await record("payment.action_failed", { intent: "hold", code });
      return { error: code };
    }
  }

  if (reservation.verification_state !== "VERIFIED") {
    await supabase.from("reservations").update({ verification_state: "VERIFIED" }).eq("id", reservationId);
    await record("reservation.verification_marked", { value: "VERIFIED", inPerson: true });
  }

  const collection = await collectBalanceAtStart(reservationId, session.userId);
  if (collection.outstandingCents > 0 && collection.chargedCents < collection.outstandingCents) {
    const override = bool(form.get("allowUnpaid")) && session.permissions.has("handover.override");
    if (!override) return { error: collection.error ?? "balance_uncollected", hold, collection };
    await record("payment.balance_waived_at_pickup", { outstandingCents: collection.outstandingCents, code: collection.error ?? null });
  }

  const inspectionId = await insertInspection({
    reservationId,
    vehicleId: reservation.assigned_vehicle_id,
    kind: "PICKUP",
    odometer,
    batteryLevel,
    accessories: { keyCard: bool(form.get("acc_keyCard")), charger: bool(form.get("acc_charger")), childSeat: bool(form.get("acc_childSeat")) },
    checklist: { license: reservation.verification_state === "VERIFIED" ? "online" : "in_person", fsdBriefing: true, returnRules: true, ...(extraDriver ? { extraDriver: true } : {}) },
    charges: [],
    damageNotes,
    renterRemarks,
    photos,
    performedBy: session.userId,
  });
  if (!inspectionId) return { error: "failed", hold };

  const { error } = await supabase.rpc("set_reservation_status", { p_reservation_id: reservationId, p_status: "ACTIVE", p_reason: null });
  if (error) return { error: error.message.includes("vehicle_required") ? "vehicle_required" : "invalid_transition", hold, collection };
  await Promise.all([
    supabase.from("reservations").update({ start_odometer: odometer }).eq("id", reservationId),
    supabase.from("vehicles").update({ odometer, battery_level: batteryLevel }).eq("id", reservation.assigned_vehicle_id),
  ]);
  await record("reservation.status_changed", { from: "CONFIRMED", to: "ACTIVE" });
  await record("reservation.pickup_completed", { inspectionId, odometer, batteryLevel, photos: photos.length, hold, collection });
  revalidatePath("/ops", "layout");
  redirect(`/reservations/${reservationId}/rate?stage=pickup`);
}

const returnInput = pickupInput.extend({
  lateNotice: z.enum(lateNotices).default("NOTIFIED"),
  damageCents: dollars,
  cleaningCents: dollars,
  otherLabel: z.string().trim().max(120),
  otherCents: dollars,
});

const feeDescriptions: Record<string, string> = {
  excess_mileage: "Excess mileage",
  low_charge: "Recharge below return target",
  late_return: "Late return",
  late_fee: "Late return fee",
  cleaning: "Cleaning",
  other: "Other post-rental charge",
};

export async function completeReturn(_: HandoverState, form: FormData): Promise<HandoverState> {
  const session = await requirePermission("vehicle.inspect");
  const parsed = returnInput.safeParse({
    reservationId: form.get("reservationId"),
    odometer: form.get("odometer"),
    batteryLevel: form.get("batteryLevel"),
    damageNotes: form.get("damageNotes") ?? "",
    renterRemarks: form.get("renterRemarks") ?? "",
    lateNotice: form.get("lateNotice") ?? "NOTIFIED",
    damageCents: form.get("damageCents") ?? "",
    cleaningCents: form.get("cleaningCents") ?? "",
    otherLabel: form.get("otherLabel") ?? "",
    otherCents: form.get("otherCents") ?? "",
  });
  if (!parsed.success) return { error: "invalid" };
  const { reservationId, odometer, batteryLevel, damageNotes, renterRemarks, lateNotice, damageCents, cleaningCents, otherLabel, otherCents } = parsed.data;
  const photos = parsePhotos(form.get("photos"), reservationId, "RETURN");
  if (!photos) return { error: "invalid" };

  const supabase = createAdminClient();
  const { data: reservation } = await supabase.from("reservations").select("id, number, status, assigned_vehicle_id").eq("id", reservationId).maybeSingle();
  if (!reservation) return { error: "not_found" };
  if (reservation.status !== "ACTIVE" || !reservation.assigned_vehicle_id) return { error: "invalid_transition" };
  const params = await loadReturnParams(reservationId);
  if (!params) return { error: "not_found" };

  const record = (action: string, metadata: Record<string, unknown>) =>
    audit({ actorUserId: session.userId, actorType: "STAFF", action, entityType: "reservation", entityId: reservationId, metadata: { by: session.displayName, number: reservation.number, ...metadata } });

  const actualReturnAt = new Date().toISOString();
  const fees = computeReturnFees({ ...params, endOdometer: odometer, batteryLevel, actualReturnAt, lateNotice, cleaningCents, otherCents });
  const feeTaxCents = params.returnFeesTaxable ? Math.round((feeTotal(fees) * params.taxRateBps) / 10000) : 0;
  const total = feeTotal(fees) + feeTaxCents;
  const charges: unknown[] = [...fees];
  if (damageCents > 0) charges.push({ code: "damage", amountCents: damageCents, pendingConsent: true });

  const inspectionId = await insertInspection({
    reservationId,
    vehicleId: reservation.assigned_vehicle_id,
    kind: "RETURN",
    odometer,
    batteryLevel,
    accessories: { keyCard: bool(form.get("acc_keyCard")), charger: bool(form.get("acc_charger")), childSeat: bool(form.get("acc_childSeat")) },
    checklist: { cleaning: cleaningCents > 0 ? "charged" : "ok", other: otherLabel || undefined },
    charges,
    damageNotes,
    renterRemarks,
    photos,
    performedBy: session.userId,
  });
  if (!inspectionId) return { error: "failed" };

  if (fees.length) {
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

  let chargedCents = 0;
  let capturedCents = 0;
  let released = false;
  let paymentError: string | undefined;
  const { data: holdRow } = await supabase.from("payments").select("id, amount_cents").eq("reservation_id", reservationId).eq("kind", "SECURITY_HOLD").eq("status", "AUTHORIZED").limit(1).maybeSingle();
  if (!stripeConfigured()) {
    if (total > 0 || holdRow) paymentError = "stripe_not_configured";
  } else {
    if (total > 0) {
      try {
        const charge = await chargeSavedCard(reservationId, { amountCents: total, description: `Post-rental charges ${reservation.number}`, kind: "ADDITIONAL", createdBy: session.userId });
        chargedCents = total;
        await record("payment.charged", { paymentId: charge.paymentId, amountCents: total, kind: "ADDITIONAL", fees });
      } catch (cause) {
        paymentError = cause instanceof PaymentError ? cause.code : "failed";
        await record("payment.action_failed", { intent: "charge", code: paymentError });
        if (holdRow) {
          const amount = Math.min(total, holdRow.amount_cents);
          try {
            await captureHold(holdRow.id, amount);
            capturedCents = amount;
            await record("security_hold.captured", { paymentId: holdRow.id, amountCents: amount, note: "post-rental charges" });
          } catch (captureCause) {
            paymentError = captureCause instanceof PaymentError ? captureCause.code : "failed";
          }
        }
      }
    }
    if (holdRow && capturedCents === 0) {
      try {
        await releaseHold(holdRow.id);
        released = true;
        await record("security_hold.released", { paymentId: holdRow.id });
      } catch (cause) {
        paymentError ??= cause instanceof PaymentError ? cause.code : "failed";
      }
    }
  }
  const uncollectedCents = Math.max(0, total - chargedCents - capturedCents);

  const { error } = await supabase.rpc("set_reservation_status", { p_reservation_id: reservationId, p_status: "COMPLETED", p_reason: null });
  if (error) return { error: "invalid_transition", fees, chargedCents, capturedCents, uncollectedCents, released, paymentError };
  const cleanState = cleaningCents > 0 ? (batteryLevel < params.minReturnLevel ? "NEEDS_BOTH" : "NEEDS_CLEANING") : batteryLevel < params.minReturnLevel ? "NEEDS_CHARGING" : "READY";
  await Promise.all([
    supabase.from("reservations").update({ end_odometer: odometer, actual_return_at: actualReturnAt }).eq("id", reservationId),
    supabase.from("vehicles").update({ odometer, battery_level: batteryLevel, clean_state: cleanState }).eq("id", reservation.assigned_vehicle_id),
  ]);
  await record("reservation.status_changed", { from: "ACTIVE", to: "COMPLETED" });
  await record("reservation.return_completed", { inspectionId, odometer, batteryLevel, photos: photos.length, fees, damageCents, chargedCents, capturedCents, uncollectedCents, released, paymentError });
  await sendTripSurvey(reservationId).catch(() => undefined);
  revalidatePath("/ops", "layout");
  redirect(`/reservations/${reservationId}/rate?stage=return`);
}

const signInput = z.object({
  reservationId: uuid,
  signerName: z.string().trim().min(2).max(120),
  initials: z.string().trim().regex(/^\p{L}{1,6}$/u),
  electronicComms: z.string().optional(),
  agree: z.literal("on"),
});

export async function signOnDevice(_: HandoverState, form: FormData): Promise<HandoverState> {
  const session = await requirePermission("reservation.edit");
  const parsed = signInput.safeParse({
    reservationId: form.get("reservationId"),
    signerName: form.get("signerName"),
    initials: form.get("initials"),
    electronicComms: form.get("electronicComms") ?? undefined,
    agree: form.get("agree"),
  });
  if (!parsed.success) return { error: "invalid" };
  const signature = signatureImageInput.safeParse(form.get("signature"));
  if (!signature.success) return { error: "signatureInvalid" };
  const { reservationId } = parsed.data;

  const supabase = createAdminClient();
  const { data: reservation } = await supabase.from("reservations").select("id, number, status, customer_id, agreement_state").eq("id", reservationId).maybeSingle();
  if (!reservation) return { error: "not_found" };
  if (["CANCELLED", "NO_SHOW", "EXPIRED", "COMPLETED"].includes(reservation.status)) return { error: "invalid_transition" };
  if (reservation.agreement_state === "SIGNED") redirect(`/reservations/${reservationId}/pickup`);

  const locale = await getLocale();
  const facts = await loadAgreementFacts(reservationId, locale);
  if (!facts) return { error: "failed" };
  const elections: Elections = {
    waiverTier: facts.waiver.tier,
    waiverInitials: parsed.data.initials,
    locationInitials: parsed.data.initials,
    electronicComms: parsed.data.electronicComms === "on",
    electronicInitials: parsed.data.initials,
    longTermInitials: isLongTerm(facts.rentalDays) ? parsed.data.initials : null,
  };
  const signedAt = new Date().toISOString();
  const rendered = renderAgreement(locale, facts, { signerName: parsed.data.signerName, signedAt, elections });
  const head = await headers();
  const { error } = await supabase.from("agreements").insert({
    reservation_id: reservationId,
    customer_id: reservation.customer_id,
    template_version: agreementVersion,
    locale,
    terms_snapshot: rendered.text,
    terms_hash: rendered.hash,
    signer_name: parsed.data.signerName,
    signer_ip: clientIpFrom(head),
    user_agent: head.get("user-agent")?.slice(0, 400) ?? null,
    signed_at: signedAt,
    elections,
    signature_image: signature.data,
  });
  if (error && error.code !== "23505") return { error: "failed" };
  await supabase.from("reservations").update({ agreement_state: "SIGNED" }).eq("id", reservationId);
  await audit({
    actorUserId: session.userId,
    actorType: "STAFF",
    action: "reservation.agreement_signed",
    entityType: "reservation",
    entityId: reservationId,
    metadata: { by: parsed.data.signerName, witnessedBy: session.displayName, number: reservation.number, version: agreementVersion, locale, hash: rendered.hash, elections, onDevice: true },
  });
  revalidatePath("/ops", "layout");
  redirect(`/reservations/${reservationId}/pickup`);
}
