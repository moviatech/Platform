import "server-only";
import { sendEmail } from "@/lib/email";
import { rootDomain } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import { PaymentError, placeSecurityHold, releaseHold } from "./service";

type HoldRow = {
  id: string;
  reservation_id: string;
  amount_cents: number;
  authorization_expires_at: string | null;
  reservation: { number: string; status: string; return_at: string } | null;
};

async function audit(action: string, reservationId: string, metadata: Record<string, unknown>) {
  await createAdminClient().from("audit_events").insert({ actor_type: "SYSTEM", action, entity_type: "reservation", entity_id: reservationId, metadata });
}

export async function renewExpiringHolds(windowHours = 36) {
  const supabase = createAdminClient();
  const horizon = new Date(Date.now() + windowHours * 3600000).toISOString();
  const { data } = await supabase
    .from("payments")
    .select("id, reservation_id, amount_cents, authorization_expires_at, reservation:reservations(number, status, return_at)")
    .eq("kind", "SECURITY_HOLD")
    .eq("status", "AUTHORIZED")
    .lt("authorization_expires_at", horizon);
  const rows = (data ?? []) as unknown as HoldRow[];
  const result = { checked: rows.length, renewed: 0, failed: 0, skipped: 0 };
  for (const row of rows) {
    const reservation = row.reservation;
    if (!reservation || !["CONFIRMED", "ACTIVE"].includes(reservation.status) || !row.authorization_expires_at) {
      result.skipped += 1;
      continue;
    }
    if (new Date(reservation.return_at).getTime() <= new Date(row.authorization_expires_at).getTime()) {
      result.skipped += 1;
      continue;
    }
    try {
      const placed = await placeSecurityHold(row.reservation_id, null, { replacing: row.id });
      await releaseHold(row.id);
      await audit("security_hold.renewed", row.reservation_id, { previousPaymentId: row.id, paymentId: placed.paymentId, status: placed.status, number: reservation.number });
      result.renewed += 1;
    } catch (cause) {
      const code = cause instanceof PaymentError ? cause.code : "failed";
      await audit("security_hold.renewal_failed", row.reservation_id, { paymentId: row.id, code, number: reservation.number, expiresAt: row.authorization_expires_at });
      result.failed += 1;
      const notify = process.env.NOTIFY_EMAIL;
      if (notify) {
        await sendEmail({
          to: notify.split(",").map((item) => item.trim()).filter(Boolean),
          subject: `[Movia] 押金续期失败 / Hold renewal failed · ${reservation.number}`,
          text: [`${reservation.number} · ${code}`, `Hold expires ${row.authorization_expires_at}`, `https://ops.${rootDomain}/reservations/${row.reservation_id}`].join("\n"),
        }).catch(() => undefined);
      }
    }
  }
  return result;
}
