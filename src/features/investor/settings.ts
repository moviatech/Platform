import "server-only";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";

export const investorSettingsSchema = z.object({
  revenueShareBps: z.number().int().min(0).max(10000).default(6000),
  settlementBusinessDays: z.number().int().min(0).max(60).default(5),
  withdrawalMinCents: z.number().int().min(0).default(10000),
  withdrawalApprovalCents: z.number().int().min(0).default(500000),
  bankCoolingHours: z.number().int().min(0).max(720).default(48),
  capitalMinCents: z.number().int().min(0).default(100000),
});

export type InvestorSettings = z.infer<typeof investorSettingsSchema>;

export async function loadInvestorSettings(): Promise<InvestorSettings> {
  const { data } = await createAdminClient().from("settings").select("value").eq("key", "investor").maybeSingle();
  const parsed = investorSettingsSchema.safeParse(data?.value ?? {});
  return parsed.success ? parsed.data : investorSettingsSchema.parse({});
}
