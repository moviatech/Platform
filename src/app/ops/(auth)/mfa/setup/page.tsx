import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { createClient } from "@/lib/supabase/server";
import { supabaseConfigured } from "@/lib/env";
import { MfaSetup } from "./MfaSetup";

export const metadata: Metadata = { title: "Set up verification" };

export default async function MfaSetupPage() {
  if (!supabaseConfigured) redirect("/setup");
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) redirect("/login");

  const { data: factors } = await supabase.auth.mfa.listFactors();
  if (factors?.totp.length) redirect("/mfa");

  const t = await getTranslations("auth");
  return (
    <>
      <p className="eyebrow">Movia Ops</p>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight">{t("mfaSetupTitle")}</h1>
      <p className="mt-2 text-sm text-muted">{t("mfaSetupLead")}</p>
      <MfaSetup />
    </>
  );
}
