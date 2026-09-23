"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createCardSetup, PaymentError } from "@/features/payments/service";
import { audit } from "@/lib/audit";
import { getCustomerSession } from "@/lib/auth/customer";
import { portalOrigin } from "@/lib/env";
import { stripeConfigured } from "@/lib/stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { preferenceKeys, readPreferences } from "./preferences";

export async function startCardSetup() {
  const session = await getCustomerSession();
  if (!session) redirect("/login");
  if (!stripeConfigured()) redirect("/account?card=unavailable");
  let url: string;
  try {
    url = await createCardSetup(session.customerId, portalOrigin);
  } catch (cause) {
    if (cause instanceof PaymentError) redirect("/account?card=unavailable");
    throw cause;
  }
  await audit({ actorUserId: session.userId, actorType: "CUSTOMER", action: "customer.card_setup_started", entityType: "customer", entityId: session.customerId, metadata: { by: session.fullName } });
  redirect(url);
}

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
