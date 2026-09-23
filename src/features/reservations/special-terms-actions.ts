"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { supersedeAgreements } from "@/features/portal/agreement-facts";
import { audit } from "@/lib/audit";
import { requirePermission } from "@/lib/auth/staff";
import { requireScope } from "@/lib/auth/scope";
import { createAdminClient } from "@/lib/supabase/admin";
import { specialTermsMax } from "./types";

export type SpecialTermsState = { ok?: boolean; error?: string; at?: number };

const terms = z
  .string()
  .transform((value) => value.replace(/\r\n?/g, "\n").trim())
  .pipe(z.string().max(specialTermsMax));

const input = z.object({ reservationId: z.uuid(), zh: terms, en: terms });

const closedStatuses = ["COMPLETED", "CANCELLED", "NO_SHOW", "EXPIRED"];

export async function saveSpecialTerms(_: SpecialTermsState, form: FormData): Promise<SpecialTermsState> {
  const session = await requirePermission("reservation.edit");
  const parsed = input.safeParse({ reservationId: form.get("reservationId"), zh: form.get("zh") ?? "", en: form.get("en") ?? "" });
  if (!parsed.success) return { error: "invalid" };
  const { reservationId, zh, en } = parsed.data;
  await requireScope(session, { reservation: reservationId });

  const supabase = createAdminClient();
  const { data: before } = await supabase.from("reservations").select("number, status, agreement_state, special_terms, special_terms_zh").eq("id", reservationId).maybeSingle();
  if (!before) return { error: "not_found" };
  if (closedStatuses.includes(before.status)) return { error: "reservation_closed" };
  if (before.agreement_state === "SIGNED") return { error: "agreement_signed" };
  if ((before.special_terms ?? "") === en && (before.special_terms_zh ?? "") === zh) return { ok: true, at: Date.now() };

  const { data: saved, error } = await supabase
    .from("reservations")
    .update({ special_terms: en || null, special_terms_zh: zh || null })
    .eq("id", reservationId)
    .neq("agreement_state", "SIGNED")
    .select("id");
  if (error) return { error: "failed" };
  if (!saved?.length) return { error: "agreement_signed" };
  await supersedeAgreements(reservationId);

  await audit({
    actorUserId: session.userId,
    actorType: "STAFF",
    action: "reservation.special_terms_updated",
    entityType: "reservation",
    entityId: reservationId,
    metadata: { by: session.displayName, number: before.number, zh, en, previousZh: before.special_terms_zh ?? "", previousEn: before.special_terms ?? "" },
  });
  revalidatePath(`/ops/reservations/${reservationId}`, "layout");
  return { ok: true, at: Date.now() };
}
