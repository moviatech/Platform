import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { isLocale, localeCookie } from "@/i18n/config";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { mfaCookie, mfaTokenValid } from "@/lib/auth/mfa";
import { supabaseConfigured } from "@/lib/env";

export type CustomerSession = {
  userId: string;
  customerId: string;
  email: string;
  fullName: string;
  phone: string | null;
  wechat: string | null;
  dateOfBirth: string | null;
  address: string | null;
  language: "zh" | "en";
  identityStatus: string;
  dnr: boolean;
  createdAt: string;
  mfaEnabled: boolean;
  mfaVerified: boolean;
};

const columns = "id, full_name, email, phone, wechat, date_of_birth, address, preferred_language, identity_status, dnr_flag, created_at, mfa_enabled";

type Row = { id: string; full_name: string; email: string | null; phone: string | null; wechat: string | null; date_of_birth: string | null; address: string | null; preferred_language: string; identity_status: string; dnr_flag: boolean; created_at: string; mfa_enabled: boolean };

export const getCustomerSession = cache(async (): Promise<CustomerSession | null> => {
  if (!supabaseConfigured) return null;
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  const userId = auth?.claims.sub;
  const email = typeof auth?.claims.email === "string" ? auth.claims.email.toLowerCase() : undefined;
  if (!userId || !email) return null;

  const admin = createAdminClient();
  let { data: customer } = await admin.from("customers").select(columns).eq("auth_user_id", userId).maybeSingle();
  if (!customer) {
    const { data: byEmail } = await admin.from("customers").select(columns).eq("email", email).is("auth_user_id", null).maybeSingle();
    if (byEmail) {
      await admin.from("customers").update({ auth_user_id: userId }).eq("id", byEmail.id);
      customer = byEmail;
    } else {
      const stored = (await cookies()).get(localeCookie)?.value;
      const { data: created } = await admin
        .from("customers")
        .insert({ full_name: email.split("@")[0], email, auth_user_id: userId, preferred_language: isLocale(stored) ? stored : "en" })
        .select(columns)
        .maybeSingle();
      if (created) customer = created;
      else ({ data: customer } = await admin.from("customers").select(columns).eq("auth_user_id", userId).maybeSingle());
    }
  }
  if (!customer) return null;
  const row = customer as Row;
  return {
    userId,
    customerId: row.id,
    email,
    fullName: row.full_name,
    phone: row.phone,
    wechat: row.wechat,
    dateOfBirth: row.date_of_birth,
    address: row.address,
    language: row.preferred_language === "zh" ? "zh" : "en",
    identityStatus: row.identity_status,
    dnr: row.dnr_flag,
    createdAt: row.created_at,
    mfaEnabled: row.mfa_enabled,
    mfaVerified: !row.mfa_enabled || mfaTokenValid((await cookies()).get(mfaCookie)?.value, userId),
  };
});

export async function requireCustomer() {
  const session = await getCustomerSession();
  if (!session) redirect("/login");
  if (!session.mfaVerified) redirect("/verify-2fa");
  return session;
}
