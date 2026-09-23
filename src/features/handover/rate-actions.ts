"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { saveRating } from "@/features/ratings/service";
import { audit } from "@/lib/audit";
import { requirePermission } from "@/lib/auth/staff";
import { createAdminClient } from "@/lib/supabase/admin";
import type { HandoverState } from "./types";

const rateInput = z.object({
  reservationId: z.uuid(),
  stage: z.enum(["pickup", "return"]),
  score: z.coerce.number().int().min(1).max(5),
  comment: z.string().trim().max(2000),
});

export async function rateOnDevice(_: HandoverState, form: FormData): Promise<HandoverState> {
  const session = await requirePermission("vehicle.inspect");
  const parsed = rateInput.safeParse({
    reservationId: form.get("reservationId"),
    stage: form.get("stage"),
    score: form.get("score"),
    comment: form.get("comment") ?? "",
  });
  if (!parsed.success) return { error: "invalid" };
  const { reservationId, stage, score, comment } = parsed.data;
  const { data: reservation } = await createAdminClient().from("reservations").select("id, number, customer_id").eq("id", reservationId).maybeSingle();
  if (!reservation) return { error: "not_found" };
  const kind = stage === "pickup" ? "PICKUP" : "RETURN";
  const saved = await saveRating({ kind, score, comment: comment || null, customerId: reservation.customer_id, reservationId, staffUserId: session.userId, source: "DEVICE" });
  if (!saved) return { error: "failed" };
  await audit({
    actorUserId: session.userId,
    actorType: "STAFF",
    action: "rating.device_submitted",
    entityType: "reservation",
    entityId: reservationId,
    metadata: { by: session.displayName, number: reservation.number, kind, score, ratingId: saved.id },
  });
  revalidatePath("/ops", "layout");
  redirect(`/reservations/${reservationId}?rated=1`);
}
