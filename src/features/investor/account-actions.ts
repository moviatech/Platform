"use server";

import { revalidatePath } from "next/cache";
import { audit } from "@/lib/audit";
import { requireInvestor } from "@/lib/auth/investor";
import { createAdminClient } from "@/lib/supabase/admin";
import { preferenceKeys, readInvestorPreferences } from "./preferences";

export async function toggleInvestorPreference(form: FormData) {
  const session = await requireInvestor();
  const key = String(form.get("key") ?? "");
  if (!(preferenceKeys as readonly string[]).includes(key)) return;
  const value = form.get("value") === "1";
  const supabase = createAdminClient();
  const { data } = await supabase.from("investors").select("preferences").eq("id", session.investorId).maybeSingle();
  const next = { ...readInvestorPreferences(data?.preferences), [key]: value };
  await supabase.from("investors").update({ preferences: next }).eq("id", session.investorId);
  await audit({ actorUserId: session.userId, actorType: "INVESTOR", action: "investor.preferences_updated", entityType: "investor", entityId: session.investorId, metadata: { key, value } });
  revalidatePath("/investor/account");
}
