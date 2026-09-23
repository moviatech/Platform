"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { can, requirePermission } from "@/lib/auth/staff";
import { createAdminClient } from "@/lib/supabase/admin";
import { aiScope, aiSettingsKey } from "./ai";
import { maxMonthlyCalls } from "./ai-math";
import { runBrief, type BriefStatus } from "./brief";
import { runTopics, type TopicsStatus } from "./topics";

const limitInput = z.union([z.number(), z.string().trim().regex(/^\d{1,4}$/).transform(Number)]).pipe(z.number().int().min(1).max(maxMonthlyCalls));

export async function saveAiLimit(value: unknown): Promise<{ status: "saved" | "badLimit" | "failed" }> {
  const session = await requirePermission("marketing.manage");
  const parsed = limitInput.safeParse(value);
  if (!parsed.success) return { status: "badLimit" };
  const scope = aiScope();
  const { error } = await createAdminClient()
    .from("marketing_sync_state")
    .upsert({ key: aiSettingsKey(scope), value: { monthlyCalls: parsed.data }, updated_at: new Date().toISOString() });
  if (error) return { status: "failed" };
  await audit({ actorUserId: session.userId, actorType: "STAFF", action: "marketing.ai_settings_updated", entityType: "marketing_ai", entityId: null, metadata: { monthlyCalls: parsed.data, scope, by: session.displayName } });
  revalidatePath("/ops/marketing/insights");
  return { status: "saved" };
}

export async function regenerateBrief(): Promise<{ status: BriefStatus }> {
  const session = await requirePermission("marketing.manage");
  let status: BriefStatus = "failed";
  try {
    status = (await runBrief({ force: true, actor: { id: session.userId, name: session.displayName } })).status;
  } catch {
    status = "failed";
  }
  await audit({ actorUserId: session.userId, actorType: "STAFF", action: "marketing.brief_regenerated", entityType: "marketing_ai", entityId: null, metadata: { status, scope: aiScope(), by: session.displayName } });
  revalidatePath("/ops/marketing/insights");
  revalidatePath("/ops/marketing/overview");
  return { status };
}

export async function generateTopics(force: unknown): Promise<{ status: TopicsStatus }> {
  const session = await requirePermission("marketing.view");
  const redo = force === true;
  if (redo && !can(session, "marketing.manage")) return { status: "forbidden" };
  let status: TopicsStatus = "failed";
  try {
    status = (await runTopics({ force: redo, limited: !can(session, "marketing.manage"), actor: { id: session.userId, name: session.displayName } })).status;
  } catch {
    status = "failed";
  }
  if (status !== "exists" && status !== "cooldown") await audit({ actorUserId: session.userId, actorType: "STAFF", action: "marketing.topics_generated", entityType: "marketing_ai", entityId: null, metadata: { status, force: redo, scope: aiScope(), by: session.displayName } });
  revalidatePath("/ops/marketing/insights");
  return { status };
}
