"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { approvalThresholdCents, requestApproval, type ApprovalKind } from "@/features/finance/approvals";
import { audit } from "@/lib/audit";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadActiveConfig } from "@/features/booking/service";
import { formatMoney } from "@/lib/utils/format";
import { requirePermission } from "@/lib/auth/staff";
import { requireScope } from "@/lib/auth/scope";
import { stripeConfigured } from "@/lib/stripe";
import { captureHold, chargeSavedCard, createCheckout, PaymentError, placeSecurityHold, refundPayment, releaseHold } from "./service";

export type PaymentActionState = { ok?: boolean; url?: string; error?: string; pending?: boolean };

const dollars = z
  .string()
  .trim()
  .regex(/^\d{1,6}(\.\d{1,2})?$/)
  .transform((value) => Math.round(Number(value) * 100));

const input = z.discriminatedUnion("intent", [
  z.object({ intent: z.literal("checkout"), reservationId: z.uuid() }),
  z.object({ intent: z.literal("hold"), reservationId: z.uuid() }),
  z.object({ intent: z.literal("release"), reservationId: z.uuid(), paymentId: z.uuid() }),
  z.object({ intent: z.literal("capture"), reservationId: z.uuid(), paymentId: z.uuid(), amount: dollars, note: z.string().trim().min(3).max(300) }),
  z.object({ intent: z.literal("charge"), reservationId: z.uuid(), amount: dollars, note: z.string().trim().max(300), kind: z.enum(["RENTAL", "ADDITIONAL", "CANCELLATION_FEE", "TOLL"]), tollDays: z.coerce.number().int().min(0).max(366).default(0) }),
  z.object({ intent: z.literal("refund"), reservationId: z.uuid(), paymentId: z.uuid(), amount: dollars, note: z.string().trim().max(300) }),
  z.object({ intent: z.literal("offline"), reservationId: z.uuid(), amount: dollars, method: z.enum(["TRANSFER", "ZELLE", "CASH", "OTHER"]), kind: z.enum(["RENTAL", "ADDITIONAL"]), note: z.string().trim().max(300) }),
]);

export async function paymentAction(_: PaymentActionState, form: FormData): Promise<PaymentActionState> {
  const parsed = input.safeParse(Object.fromEntries(form.entries()));
  if (!parsed.success) return { error: "invalid" };
  const data = parsed.data;

  const session = await requirePermission(data.intent === "refund" ? "payment.refund" : "payment.capture");
  await requireScope(session, { reservation: data.reservationId });
  if (data.intent !== "offline" && !stripeConfigured()) return { error: "stripe_not_configured" };
  if ((data.intent === "refund" || data.intent === "capture" || data.intent === "charge") && data.amount > approvalThresholdCents && !session.permissions.has("finance.approve")) {
    await requestApproval({
      kind: data.intent.toUpperCase() as ApprovalKind,
      reservationId: data.reservationId,
      paymentId: data.intent === "charge" ? null : data.paymentId,
      amountCents: data.amount,
      reason: data.note,
      payload: data.intent === "charge" ? { intent: data.intent, kind: data.kind } : { intent: data.intent },
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
    switch (data.intent) {
      case "checkout": {
        const checkout = await createCheckout(data.reservationId, { createdBy: session.userId, holdMinutes: 24 * 60 - 5 });
        url = checkout.url;
        await record("payment.link_created", { paymentId: checkout.paymentId });
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
        break;
      case "charge": {
        if (data.kind !== "TOLL" && data.note.length < 3) return { error: "invalid" };
        const handlingCents = data.kind === "TOLL" ? data.tollDays * (await loadActiveConfig()).data.tolls.adminFeeCentsPerDay : 0;
        const amountCents = data.amount + handlingCents;
        const note = data.kind === "TOLL" ? `Tolls ${formatMoney(data.amount)} · ${data.tollDays} day(s) handling ${formatMoney(handlingCents)}${data.note ? ` · ${data.note}` : ""}` : data.note;
        const charge = await chargeSavedCard(data.reservationId, { amountCents, description: note, kind: data.kind === "TOLL" ? "ADDITIONAL" : data.kind, createdBy: session.userId });
        if (charge.status === "succeeded" && data.kind !== "RENTAL") {
          await createAdminClient().from("reservation_line_items").insert({
            reservation_id: data.reservationId,
            type: "ADDITIONAL",
            code: data.kind === "CANCELLATION_FEE" ? "charge.cancellation" : data.kind === "TOLL" ? "charge.toll" : "charge.additional",
            description: note,
            quantity: 1,
            unit_cents: amountCents,
            amount_cents: amountCents,
            taxable: false,
            sort_order: 300,
          });
          if (data.kind === "TOLL") await createAdminClient().from("reservations").update({ toll_pending: false }).eq("id", data.reservationId);
        }
        await record("payment.charged", { paymentId: charge.paymentId, amountCents, kind: data.kind, note, tollDays: data.tollDays });
        break;
      }
      case "refund":
        await refundPayment(data.paymentId, data.amount, data.note || null, session.userId);
        await record("payment.refund_created", { paymentId: data.paymentId, amountCents: data.amount, note: data.note });
        break;
      case "offline": {
        if (data.amount <= 0) return { error: "invalid_amount" };
        const supabase = createAdminClient();
        const { data: reservation } = await supabase.from("reservations").select("customer_id").eq("id", data.reservationId).maybeSingle();
        if (!reservation?.customer_id) return { error: "not_found" };
        const { data: payment, error } = await supabase
          .from("payments")
          .insert({ reservation_id: data.reservationId, customer_id: reservation.customer_id, kind: data.kind, status: "SUCCEEDED", amount_cents: data.amount, amount_captured_cents: data.amount, description: data.note || null, offline_method: data.method, created_by: session.userId })
          .select("id")
          .single();
        if (error || !payment) return { error: "failed" };
        if (data.kind === "ADDITIONAL") {
          await supabase.from("reservation_line_items").insert({ reservation_id: data.reservationId, type: "ADDITIONAL", code: "charge.additional", description: data.note || "Offline payment", quantity: 1, unit_cents: data.amount, amount_cents: data.amount, taxable: false, sort_order: 300 });
        }
        await supabase.rpc("sync_reservation_payment_state", { p_reservation_id: data.reservationId });
        await record("payment.offline_recorded", { paymentId: payment.id, amountCents: data.amount, method: data.method, kind: data.kind, note: data.note });
        break;
      }
    }
    revalidatePath(`/ops/reservations/${data.reservationId}`);
    return { ok: true, url };
  } catch (cause) {
    revalidatePath(`/ops/reservations/${data.reservationId}`);
    if (cause instanceof PaymentError) {
      await record("payment.action_failed", { intent: data.intent, code: cause.code });
      return { error: cause.code };
    }
    throw cause;
  }
}
