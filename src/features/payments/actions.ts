"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { requirePermission } from "@/lib/auth/staff";
import { stripeConfigured } from "@/lib/stripe";
import { captureHold, chargeSavedCard, createCheckout, PaymentError, placeSecurityHold, refundPayment, releaseHold } from "./service";

export type PaymentActionState = { ok?: boolean; url?: string; error?: string };

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
  z.object({ intent: z.literal("charge"), reservationId: z.uuid(), amount: dollars, note: z.string().trim().min(3).max(300), kind: z.enum(["RENTAL", "ADDITIONAL", "CANCELLATION_FEE"]) }),
  z.object({ intent: z.literal("refund"), reservationId: z.uuid(), paymentId: z.uuid(), amount: dollars, note: z.string().trim().max(300) }),
]);

export async function paymentAction(_: PaymentActionState, form: FormData): Promise<PaymentActionState> {
  const parsed = input.safeParse(Object.fromEntries(form.entries()));
  if (!parsed.success) return { error: "invalid" };
  const data = parsed.data;

  const session = await requirePermission(data.intent === "refund" ? "payment.refund" : "payment.capture");
  if (!stripeConfigured()) return { error: "stripe_not_configured" };

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
        const charge = await chargeSavedCard(data.reservationId, { amountCents: data.amount, description: data.note, kind: data.kind, createdBy: session.userId });
        await record("payment.charged", { paymentId: charge.paymentId, amountCents: data.amount, kind: data.kind, note: data.note });
        break;
      }
      case "refund":
        await refundPayment(data.paymentId, data.amount, data.note || null, session.userId);
        await record("payment.refund_created", { paymentId: data.paymentId, amountCents: data.amount, note: data.note });
        break;
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
