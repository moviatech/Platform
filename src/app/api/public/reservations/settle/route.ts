import { z } from "zod";
import { guardedJson, InvalidBody } from "@/features/booking/public-api";
import { PaymentError, settleRentalIntent } from "@/features/payments/service";
import { createAdminClient } from "@/lib/supabase/admin";

const input = z.object({ number: z.string().regex(/^MV-[A-Z0-9]{6}$/), paymentIntentId: z.string().regex(/^pi_[A-Za-z0-9]+$/) });

export async function POST(request: Request) {
  return guardedJson(request, async (body) => {
    const parsed = input.safeParse(body);
    if (!parsed.success) throw new InvalidBody();
    const { data: reservation } = await createAdminClient().from("reservations").select("id").eq("number", parsed.data.number).maybeSingle();
    if (!reservation) return { status: "not_found" };
    try {
      const result = await settleRentalIntent(parsed.data.paymentIntentId, reservation.id);
      return { status: result.status, confirmed: result.confirmed };
    } catch (cause) {
      return { status: "failed", error: cause instanceof PaymentError ? cause.code : "failed" };
    }
  });
}
