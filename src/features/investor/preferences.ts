import "server-only";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";

export const preferenceKeys = ["earnings", "vehicle", "messages"] as const;
export type PreferenceKey = (typeof preferenceKeys)[number];

const schema = z.object({ earnings: z.boolean().default(true), vehicle: z.boolean().default(true), messages: z.boolean().default(true) });
export type InvestorPreferences = z.infer<typeof schema>;

export function readInvestorPreferences(value: unknown): InvestorPreferences {
  const parsed = schema.safeParse(value ?? {});
  return parsed.success ? parsed.data : schema.parse({});
}

const categories: Record<string, PreferenceKey> = {
  share_settled: "earnings",
  hold_placed: "earnings",
  hold_released: "earnings",
  ledger_adjusted: "earnings",
  vehicle_onboarded: "vehicle",
  vehicle_allocated: "vehicle",
  allocation_ended: "vehicle",
  exit_updated: "vehicle",
  document_added: "vehicle",
};

export async function loadInvestorPreferences(investorId: string): Promise<InvestorPreferences> {
  const { data } = await createAdminClient().from("investors").select("preferences").eq("id", investorId).maybeSingle();
  return readInvestorPreferences(data?.preferences);
}

export async function emailAllowed(investorId: string, kind: string) {
  const category = categories[kind];
  if (!category) return true;
  const preferences = await loadInvestorPreferences(investorId);
  return preferences[category];
}
