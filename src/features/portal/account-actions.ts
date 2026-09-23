"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { audit } from "@/lib/audit";
import { getCustomerSession } from "@/lib/auth/customer";
import { portalOrigin } from "@/lib/env";
import { getStripe, stripeConfigured } from "@/lib/stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { preferenceKeys, readPreferences } from "./preferences";

export async function togglePreference(form: FormData) {
  const session = await getCustomerSession();
  if (!session) redirect("/login");
  const key = String(form.get("key") ?? "");
  if (!(preferenceKeys as readonly string[]).includes(key)) return;
  const value = form.get("value") === "1";
  const supabase = createAdminClient();
  const { data } = await supabase.from("customers").select("preferences").eq("id", session.customerId).maybeSingle();
  const next = { ...readPreferences(data?.preferences), [key]: value };
  await supabase.from("customers").update({ preferences: next }).eq("id", session.customerId);
  await audit({ actorUserId: session.userId, actorType: "CUSTOMER", action: "customer.preferences_updated", entityType: "customer", entityId: session.customerId, metadata: { key, value } });
  revalidatePath("/account");
}

export async function startIdentityFromAccount() {
  const session = await getCustomerSession();
  if (!session) redirect("/login");
  if (!stripeConfigured()) redirect("/account");
  let url: string | null = null;
  try {
    const verification = await getStripe().identity.verificationSessions.create({
      type: "document",
      metadata: { customer_id: session.customerId },
      options: { document: { allowed_types: ["driving_license"], require_matching_selfie: true, require_live_capture: true } },
      return_url: `${portalOrigin}/account?identity=submitted`,
    });
    url = verification.url ?? null;
    await createAdminClient().from("customers").update({ identity_status: "SUBMITTED", identity_session_id: verification.id, identity_error: null }).eq("id", session.customerId);
    await audit({ actorUserId: session.userId, actorType: "CUSTOMER", action: "customer.identity_started", entityType: "customer", entityId: session.customerId, metadata: { sessionId: verification.id, by: session.fullName } });
  } catch (cause) {
    console.error("[identity:create]", cause instanceof Error ? cause.message : cause);
  }
  redirect(url ?? "/account");
}
