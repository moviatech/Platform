"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { requirePermission } from "@/lib/auth/staff";
import { createAdminClient } from "@/lib/supabase/admin";

export async function markPriceReviewed(form: FormData) {
  const session = await requirePermission("finance.review");
  const parsed = z.uuid().safeParse(form.get("reservationId"));
  if (!parsed.success) return;
  await createAdminClient().from("reservations").update({ price_reviewed_at: new Date().toISOString(), price_reviewed_by: session.userId }).eq("id", parsed.data);
  await audit({ actorUserId: session.userId, actorType: "STAFF", action: "reservation.price_reviewed", entityType: "reservation", entityId: parsed.data, metadata: { by: session.displayName } });
  revalidatePath("/ops/finance");
  revalidatePath(`/ops/reservations/${parsed.data}`);
}
