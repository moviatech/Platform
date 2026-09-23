"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { BookingError } from "@/features/booking/service";
import { zonedParts } from "@/features/booking/time";
import { postConversationMessage } from "@/features/inbox/outbound";
import { audit } from "@/lib/audit";
import { requirePermission } from "@/lib/auth/staff";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatFullDateTime, formatMoney } from "@/lib/utils/format";
import type { ReservationActionState } from "./actions";
import { applyChange, currentChangeInput, loadEditableReservation, type ChangeInput } from "./apply-change";

const input = z.object({
  requestId: z.uuid(),
  decision: z.enum(["approve", "decline", "need_info"]),
  fee: z
    .string()
    .trim()
    .regex(/^(\d{1,6}(\.\d{1,2})?)?$/)
    .transform((value) => (value ? Math.round(Number(value) * 100) : 0)),
  note: z.string().trim().max(2000),
});

const replies = {
  zh: {
    approved: (detail: string, fee: number) => `您的修改请求已确认${detail ? `：${detail}` : ""}。${fee > 0 ? `本次改期手续费 ${formatMoney(fee)}，已计入订单。` : ""}更新后的订单详情见行程页。`,
    declined: "很抱歉，这次的修改请求无法安排。",
    needInfo: "关于您的修改请求，我们需要再确认一些信息。",
    feeLabel: "改期手续费",
    addOns: { driver: "已添加附加驾驶人", childSeat: "已添加儿童座椅" } as Record<string, string>,
  },
  en: {
    approved: (detail: string, fee: number) => `Your change request has been confirmed${detail ? `: ${detail}` : ""}. ${fee > 0 ? `A change fee of ${formatMoney(fee)} has been added to the reservation. ` : ""}The updated details are on your trip page.`,
    declined: "Unfortunately we are unable to accommodate this change.",
    needInfo: "We need a little more information about your change request.",
    feeLabel: "Change fee",
    addOns: { driver: "additional driver added", childSeat: "child seat added" } as Record<string, string>,
  },
};

export async function reviewChangeRequest(_: ReservationActionState, form: FormData): Promise<ReservationActionState> {
  const session = await requirePermission("reservation.edit");
  const parsed = input.safeParse({ requestId: form.get("requestId"), decision: form.get("decision"), fee: form.get("fee") ?? "", note: form.get("note") ?? "" });
  if (!parsed.success) return { error: "invalid" };
  const { requestId, decision, fee, note } = parsed.data;

  const supabase = createAdminClient();
  const { data: request } = await supabase
    .from("change_requests")
    .select("id, reservation_id, conversation_id, kind, status, payload, conversation:conversations(locale)")
    .eq("id", requestId)
    .maybeSingle();
  const row = request as unknown as { id: string; reservation_id: string; conversation_id: string | null; kind: string; status: string; payload: { pickupAt?: string; returnAt?: string }; conversation: { locale: string | null } | null } | null;
  if (!row) return { error: "not_found" };
  if (!["SUBMITTED", "IN_REVIEW", "NEED_INFO"].includes(row.status)) return { error: "invalid_transition" };
  const reservation = await loadEditableReservation(row.reservation_id);
  if (!reservation) return { error: "not_found" };
  const locale = row.conversation?.locale === "en" ? "en" : "zh";
  const copy = replies[locale];
  const actor = { userId: session.userId, displayName: session.displayName };

  let detail = "";
  if (decision === "approve") {
    const overrides: Partial<ChangeInput> = {};
    const details: string[] = [];
    if (row.payload.pickupAt && row.payload.returnAt) {
      const zone = "America/Los_Angeles";
      const pickup = zonedParts(row.payload.pickupAt, zone);
      const dropoff = zonedParts(row.payload.returnAt, zone);
      Object.assign(overrides, { pickupDate: pickup.date, pickupTime: pickup.time, returnDate: dropoff.date, returnTime: dropoff.time });
      details.push(`${formatFullDateTime(row.payload.pickupAt, locale)} → ${formatFullDateTime(row.payload.returnAt, locale)}`);
    }
    if (copy.addOns[row.kind] && !reservation.add_ons.includes(row.kind)) {
      overrides.addOns = [...reservation.add_ons, row.kind];
      details.push(copy.addOns[row.kind]);
    }
    if (Object.keys(overrides).length > 0) {
      try {
        await applyChange(reservation, currentChangeInput(reservation, overrides), actor, { feeCents: fee, feeDescription: copy.feeLabel, source: "customer_request" });
      } catch (cause) {
        if (cause instanceof BookingError) return { error: cause.code };
        throw cause;
      }
    }
    detail = details.join(" · ");
  }

  const status = decision === "approve" ? "APPROVED" : decision === "decline" ? "DECLINED" : "NEED_INFO";
  await supabase
    .from("change_requests")
    .update({ status, staff_note: note || null, fee_cents: decision === "approve" ? fee : null, resolved_by: session.userId, resolved_at: decision === "need_info" ? null : new Date().toISOString() })
    .eq("id", requestId);

  const body = `${decision === "approve" ? copy.approved(detail, fee) : decision === "decline" ? copy.declined : copy.needInfo}${note ? `\n\n${note}` : ""}`;
  if (row.conversation_id) await postConversationMessage({ conversationId: row.conversation_id, body, actor, persona: "trip" });
  await audit({ actorUserId: session.userId, actorType: "STAFF", action: "reservation.change_reviewed", entityType: "reservation", entityId: row.reservation_id, metadata: { by: session.displayName, requestId, decision, feeCents: fee, note: note || undefined } });
  revalidatePath("/ops", "layout");
  return { ok: true };
}
