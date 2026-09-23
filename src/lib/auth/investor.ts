import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { mfaCookie, mfaTokenValid } from "@/lib/auth/mfa";
import { supabaseConfigured } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const investorStatuses = ["PENDING", "ACTIVE", "SUSPENDED", "REJECTED", "CLOSED"] as const;
export type InvestorStatus = (typeof investorStatuses)[number];

export type InvestorRow = {
  id: string;
  investor_number: string;
  auth_user_id: string | null;
  legal_name: string;
  email: string;
  phone: string;
  preferred_language: string;
  status: InvestorStatus;
  created_at: string;
};

export type InvestorAuth = { userId: string; email: string; investor: InvestorRow | null; mfaVerified: boolean };

export type InvestorSession = {
  userId: string;
  investorId: string;
  number: string;
  legalName: string;
  email: string;
  phone: string;
  language: "zh" | "en";
  status: InvestorStatus;
  createdAt: string;
};

export const investorColumns = "id, investor_number, auth_user_id, legal_name, email, phone, preferred_language, status, created_at";

export const getInvestorAuth = cache(async (): Promise<InvestorAuth | null> => {
  if (!supabaseConfigured) return null;
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  const userId = auth?.claims.sub;
  const email = typeof auth?.claims.email === "string" ? auth.claims.email.toLowerCase() : undefined;
  if (!userId || !email) return null;
  const admin = createAdminClient();
  let { data: investor } = await admin.from("investors").select(investorColumns).eq("auth_user_id", userId).maybeSingle();
  if (!investor) {
    const { data: byEmail } = await admin.from("investors").select(investorColumns).ilike("email", email).is("auth_user_id", null).maybeSingle();
    if (byEmail) {
      const { data: linked } = await admin.from("investors").update({ auth_user_id: userId }).eq("id", byEmail.id).select(investorColumns).maybeSingle();
      investor = linked ?? byEmail;
    }
  }
  return {
    userId,
    email,
    investor: (investor as InvestorRow | null) ?? null,
    mfaVerified: mfaTokenValid((await cookies()).get(mfaCookie)?.value, userId),
  };
});

export function toSession(auth: InvestorAuth, investor: InvestorRow): InvestorSession {
  return {
    userId: auth.userId,
    investorId: investor.id,
    number: investor.investor_number,
    legalName: investor.legal_name,
    email: investor.email,
    phone: investor.phone,
    language: investor.preferred_language === "en" ? "en" : "zh",
    status: investor.status,
    createdAt: investor.created_at,
  };
}

export async function requireInvestor(): Promise<InvestorSession> {
  const auth = await getInvestorAuth();
  if (!auth) redirect("/login");
  if (!auth.investor) redirect("/apply");
  if (auth.investor.status !== "ACTIVE") redirect("/pending");
  if (!auth.mfaVerified) redirect("/verify-2fa");
  return toSession(auth, auth.investor);
}
