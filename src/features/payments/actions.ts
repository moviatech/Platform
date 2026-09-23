"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { approvalThresholdCents, requestApproval, type ApprovalKind } from "@/features/finance/approvals";
import { audit } from "@/lib/audit";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadActiveConfig } from "@/features/booking/service";
import { notifyReservation } from "@/features/notifications/emails";
import { notifyPaymentReceipt } from "@/features/notifications/receipts";
import { requirePermission } from "@/lib/auth/staff";
import { requireScope } from "@/lib/auth/scope";
import { stripeConfigured } from "@/lib/stripe";
import { chargeLine, planCharge, rentalKinds } from "./charge-line";
import { payLinkRecipient, sendPayLinkEmail } from "./link-email";
import { offlineMethods } from "./method";
import { payUrl } from "./pay-link";
import { captureHold, chargeSavedCard, closeStaleCheckouts, createCheckout, loadOrderDues, paidRentalCents, PaymentError, placeSecurityHold, refundOfflinePayment, refundPayment, releaseHold } from "./service";

export type PaymentActionState = { ok?: boolean; url?: string; sentTo?: string; error?: string; pending?: boolean };

const dollars = z
  .string()
  .trim()
  .regex(/^\d{1,6}(\.\d{1,2})?$/)
  .transform((value) => Math.round(Number(value) * 100));

const input = z.discriminatedUnion("intent", [
  z.object({ intent: z.literal("checkout"), reservationId: z.uuid() }),
  z.object({ intent: z.literal("checkout_email"), reservationId: z.uuid() }),
  z.object({ intent: z.literal("hold"), reservationId: z.uuid() }),
  z.object({ intent: z.literal("release"), reservationId: z.uuid(), paymentId: z.uuid() }),
  z.object({ intent: z.literal("capture"), reservationId: z.uuid(), paymentId: z.uuid(), amount: dollars, note: z.string().trim().min(3).max(300) }),
  z.object({ intent: z.literal("charge"), reservationId: z.uuid(), amount: dollars, note: z.string().trim().max(300), kind: z.enum(["RENTAL", "ADDITIONAL", "CANCELLATION_FEE", "TOLL", "SETTLE"]), tollDays: z.coerce.number().int().min(0).max(366).default(0) }),
  z.object({ intent: z.literal("refund"), reservationId: z.uuid(), paymentId: z.uuid(), amount: dollars, note: z.string().trim().max(300), method: z.enum(offlineMethods).optional() }),
  z.object({ intent: z.literal("offline"), reservationId: z.uuid(), amount: dollars, method: z.enum(offlineMethods), kind: z.enum(["RENTAL", "ADDITIONAL", "SETTLE"]), note: z.string().trim().max(300) }),
]);

export async function paymentAction(_: PaymentActionState, form: FormData): Promise<PaymentActionState> {
  const parsed = input.safeParse(Object.fromEntries(form.entries()));
  if (!parsed.success) return { error: "invalid" };
  const data = parsed.data;

  const session = await requirePermission(data.intent === "refund" ? "payment.refund" : "payment.capture");
  await requireScope(session, { reservation: data.reservationId });
  const target = "paymentId" in data ? (await createAdminClient().from("payments").select("reservation_id, offline_method").eq("id", data.paymentId).maybeSingle()).data : null;
  if ("paymentId" in data && target?.reservation_id !== data.reservationId) return { error: "payment_not_found" };
  const refundMethod = data.intent === "refund" && target?.offline_method ? (data.method ?? offlineMethods.find((method) => method === target.offline_method) ?? "OTHER") : null;
  if (data.intent !== "offline" && !refundMethod && !stripeConfigured()) return { error: "stripe_not_configured" };
  if (data.intent === "charge" && data.kind !== "TOLL" && data.note.length < 3) return { error: "invalid" };
  if ((data.intent === "charge" || data.intent === "offline") && data.kind === "SETTLE") {
    const dues = await loadOrderDues(data.reservationId);
    if (!dues || data.amount <= 0 || data.amount > dues.extrasDueCents) return { error: "invalid_amount" };
  }
  if (data.intent === "charge" && data.kind === "RENTAL") {
    const { data: current } = await createAdminClient().from("reservations").select("status").eq("id", data.reservationId).maybeSingle();
    if (!current || ["CANCELLED", "NO_SHOW", "EXPIRED"].includes(current.status)) return { error: "reservation_closed" };
    const dues = await loadOrderDues(data.reservationId);
    if (!dues || data.amount > dues.balanceCents - dues.extrasDueCents) return { error: "already_paid" };
  }
  const plan = data.intent === "charge" ? planCharge({ kind: data.kind, amountCents: data.amount, note: data.note, tollDays: data.tollDays, adminFeeCentsPerDay: data.kind === "TOLL" ? (await loadActiveConfig()).data.tolls.adminFeeCentsPerDay : 0 }) : null;
  if ((data.intent === "refund" || data.intent === "capture" || data.intent === "charge") && (plan ? plan.amountCents : data.amount) > approvalThresholdCents && !session.permissions.has("finance.approve")) {
    if (data.intent === "charge" && data.kind === "SETTLE") {
      const { count } = await createAdminClient().from("approvals").select("id", { count: "exact", head: true }).eq("kind", "CHARGE").eq("status", "PENDING").eq("reservation_id", data.reservationId).eq("payload->>settle", "true");
      if (count) return { ok: true, pending: true };
    }
    await requestApproval({
      kind: data.intent.toUpperCase() as ApprovalKind,
      reservationId: data.reservationId,
      paymentId: data.intent === "charge" ? null : data.paymentId,
      amountCents: plan ? plan.amountCents : data.amount,
      reason: plan ? plan.note : data.note,
      payload: plan ? { intent: data.intent, kind: plan.kind, lineCode: plan.lineCode, toll: plan.toll, settle: data.intent === "charge" && data.kind === "SETTLE" } : refundMethod ? { intent: data.intent, method: refundMethod } : { intent: data.intent },
      requestedBy: session.userId,
      requesterName: session.displayName,
    });
    revalidatePath(`/ops/reservations/${data.reservationId}`);
    return { ok: true, pending: true };
  }

  const record = (action: string, metadata: Record<string, unknown>) =>
    audit({ actorUserId: session.userId, actorType: "STAFF", action, entityType: "reservation", entityId: data.reservationId, metadata: { by: session.displayName, ...metadata } });

  try {
    let url: string | undefined;
    let sentTo: string | undefined;
    switch (data.intent) {
      case "checkout":
      case "checkout_email": {
        if (data.intent === "checkout_email" && !(await payLinkRecipient(data.reservationId))) return { error: "no_email" };
        const checkout = await createCheckout(data.reservationId, { createdBy: session.userId, holdMinutes: 24 * 60 - 5, minLeftMinutes: data.intent === "checkout_email" ? 12 * 60 : 0 });
        await createAdminClient().from("reservations").update({ expires_at: checkout.expiresAt.toISOString() }).eq("id", data.reservationId).in("status", ["REQUESTED", "PENDING_PAYMENT"]).lt("expires_at", checkout.expiresAt.toISOString());
        if (data.intent === "checkout") {
          url = payUrl(checkout.paymentId);
          await record("payment.link_created", { paymentId: checkout.paymentId });
          break;
        }
        const mail = await sendPayLinkEmail(data.reservationId, checkout);
        if (!mail.sent) {
          await record("payment.link_created", { paymentId: checkout.paymentId, email: mail.reason });
          revalidatePath(`/ops/reservations/${data.reservationId}`);
          return { error: mail.reason };
        }
        sentTo = mail.to;
        await record("payment.link_emailed", { paymentId: checkout.paymentId, to: mail.to });
        break;
      }
      case "hold": {
        const hold = await placeSecurityHold(data.reservationId, session.userId);
        await record("security_hold.authorized", { paymentId: hold.paymentId, status: hold.status });
        break;
      }
      case "release":
        await releaseHold(data.paymentId);
        await record("security_hold.released", { paymentId: data.paymentId });
        break;
      case "capture":
        await captureHold(data.paymentId, data.amount);
        await record("security_hold.captured", { paymentId: data.paymentId, amountCents: data.amount, note: data.note });
        await notifyPaymentReceipt(data.paymentId, { reason: "hold", note: data.note || null, amountCents: data.amount }).catch(() => undefined);
        break;
      case "charge": {
        if (!plan) return { error: "invalid" };
        const { amountCents, note } = plan;
        const charge = await chargeSavedCard(data.reservationId, { amountCents, description: note, kind: plan.kind, createdBy: session.userId });
        if (charge.status === "succeeded" && plan.lineCode) {
          await createAdminClient().from("reservation_line_items").insert(chargeLine(data.reservationId, { lineCode: plan.lineCode, amountCents, note }));
          if (plan.toll) await createAdminClient().from("reservations").update({ toll_pending: false }).eq("id", data.reservationId);
        }
        await record("payment.charged", { paymentId: charge.paymentId, amountCents, kind: data.kind, note, tollDays: data.tollDays });
        if (charge.status === "succeeded" && data.kind !== "RENTAL") await notifyPaymentReceipt(charge.paymentId, { reason: data.kind === "CANCELLATION_FEE" ? "cancellation" : "additional", note }).catch(() => undefined);
        break;
      }
      case "refund":
        if (refundMethod) {
          await refundOfflinePayment(data.paymentId, data.amount, refundMethod, data.note || null, session.userId);
          await record("payment.offline_refund_recorded", { paymentId: data.paymentId, amountCents: data.amount, method: refundMethod, note: data.note });
        } else {
          await refundPayment(data.paymentId, data.amount, data.note || null, session.userId);
          await record("payment.refund_created", { paymentId: data.paymentId, amountCents: data.amount, note: data.note });
        }
        break;
      case "offline": {
        if (data.amount <= 0) return { error: "invalid_amount" };
        const supabase = createAdminClient();
        const { data: reservation } = await supabase.from("reservations").select("customer_id").eq("id", data.reservationId).maybeSingle();
        if (!reservation?.customer_id) return { error: "not_found" };
        const { data: payment, error } = await supabase
          .from("payments")
          .insert({ reservation_id: data.reservationId, customer_id: reservation.customer_id, kind: data.kind === "SETTLE" ? "ADDITIONAL" : data.kind, status: "SUCCEEDED", amount_cents: data.amount, amount_captured_cents: data.amount, description: data.note || null, offline_method: data.method, created_by: session.userId })
          .select("id")
          .single();
        if (error || !payment) return { error: "failed" };
        if (data.kind === "ADDITIONAL") {
          await supabase.from("reservation_line_items").insert(chargeLine(data.reservationId, { lineCode: "charge.additional", amountCents: data.amount, note: data.note || "Offline payment" }));
        }
        await supabase.rpc("sync_reservation_payment_state", { p_reservation_id: data.reservationId });
        await record("payment.offline_recorded", { paymentId: payment.id, amountCents: data.amount, method: data.method, kind: data.kind, note: data.note });
        if (data.kind === "RENTAL") {
          await closeStaleCheckouts(data.reservationId).catch(() => undefined);
          const { data: open } = await supabase.from("reservations").select("status, total_cents").eq("id", data.reservationId).maybeSingle();
          if (open && ["REQUESTED", "PENDING_PAYMENT"].includes(open.status) && (await paidRentalCents(data.reservationId, rentalKinds)) >= open.total_cents) {
            const { error: transition } = await supabase.rpc("set_reservation_status", { p_reservation_id: data.reservationId, p_status: "CONFIRMED", p_reason: null });
            if (!transition) {
              await record("reservation.status_changed", { from: open.status, to: "CONFIRMED" });
              await notifyReservation("confirmed", data.reservationId, { dedupeKey: `confirmed:${data.reservationId}` }).catch(() => undefined);
            }
          }
        }
        await notifyPaymentReceipt(payment.id, { note: data.note || null }).catch(() => undefined);
        break;
      }
    }
    revalidatePath(`/ops/reservations/${data.reservationId}`);
    return { ok: true, url, sentTo };
  } catch (cause) {
    revalidatePath(`/ops/reservations/${data.reservationId}`);
    if (cause instanceof PaymentError) {
      await record("payment.action_failed", { intent: data.intent, code: cause.code });
      return { error: cause.code };
    }
    throw cause;
  }
}
