"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { requirePermission } from "@/lib/auth/staff";
import { createAdminClient } from "@/lib/supabase/admin";
import { linesHash, type ReviewLine } from "./price-review";

export async function markPriceReviewed(form: FormData) {
  const session = await requirePermission("finance.review");
  const parsed = z.uuid().safeParse(form.get("reservationId"));
  if (!parsed.success) return;
  const admin = createAdminClient();
  const [{ data: order }, { data: lines }] = await Promise.all([
    admin.from("reservations").select("id, total_cents").eq("id", parsed.data).maybeSingle(),
    admin.from("reservation_line_items").select("type, code, amount_cents").eq("reservation_id", parsed.data),
  ]);
  if (!order) return;
  const saved = await admin.from("fin_price_reviews").upsert({ reservation_id: order.id, reviewed_by: session.userId, reviewed_at: new Date().toISOString(), total_cents: order.total_cents, lines_hash: linesHash((lines ?? []) as ReviewLine[]) }, { onConflict: "reservation_id" });
  if (saved.error) return;
  await audit({ actorUserId: session.userId, actorType: "STAFF", action: "reservation.price_reviewed", entityType: "reservation", entityId: parsed.data, metadata: { by: session.displayName } });
  revalidatePath("/ops/finance", "layout");
  revalidatePath(`/ops/reservations/${parsed.data}`);
}
