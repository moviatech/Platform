"use server";

import { revalidatePath } from "next/cache";
import { audit } from "@/lib/audit";
import { createAdminClient } from "@/lib/supabase/admin";
import { listTouchpoints, normalizeScore, saveRating } from "./service";

export type SurveyState = { ok?: boolean; error?: "invalid" | "empty" };

export async function submitSurvey(_: SurveyState, form: FormData): Promise<SurveyState> {
  const token = String(form.get("token") ?? "");
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return { error: "invalid" };
  const supabase = createAdminClient();
  const { data: survey } = await supabase.from("trip_surveys").select("id, reservation_id, customer_id, completed_at").eq("token", token).maybeSingle();
  if (!survey) return { error: "invalid" };
  const touchpoints = await listTouchpoints(survey.reservation_id);
  let saved = 0;
  for (const point of touchpoints) {
    const score = normalizeScore(form.get(`score:${point.key}`));
    if (!score) continue;
    const comment = String(form.get(`comment:${point.key}`) ?? "").trim().slice(0, 2000) || null;
    await saveRating({ kind: point.kind, score, comment, customerId: survey.customer_id, reservationId: survey.reservation_id, staffUserId: point.staffUserId, source: "SURVEY" });
    saved += 1;
  }
  const recommendRaw = Number(form.get("recommend"));
  const recommend = Number.isInteger(recommendRaw) && recommendRaw >= 0 && recommendRaw <= 10 ? recommendRaw : null;
  const reason = String(form.get("reason") ?? "").trim().slice(0, 2000) || null;
  if (saved === 0 && recommend === null) return { error: "empty" };
  await supabase.from("trip_surveys").update({ completed_at: new Date().toISOString(), recommend_score: recommend, recommend_reason: reason }).eq("id", survey.id);
  await audit({ actorUserId: null, actorType: "CUSTOMER", action: "survey.completed", entityType: "reservation", entityId: survey.reservation_id, metadata: { ratings: saved, recommend } });
  revalidatePath(`/account/survey/${token}`);
  return { ok: true };
}
