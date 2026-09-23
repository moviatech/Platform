"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth/staff";
import { stripeConfigured } from "@/lib/stripe";
import { syncStripe } from "./stripe-sync";

export type StripeSyncState = { ok?: boolean; error?: "not_configured" | "failed"; transactions?: number };

export async function runStripeSync(_: StripeSyncState, form: FormData): Promise<StripeSyncState> {
  const session = await requirePermission("finance.review");
  if (!stripeConfigured()) return { error: "not_configured" };
  try {
    const result = await syncStripe({ full: form.get("full") === "1", actor: { userId: session.userId, displayName: session.displayName } });
    revalidatePath("/ops/finance", "layout");
    return { ok: true, transactions: result.transactions };
  } catch (cause) {
    console.error("[stripe:sync]", cause instanceof Error ? cause.message : cause);
    return { error: "failed" };
  }
}
