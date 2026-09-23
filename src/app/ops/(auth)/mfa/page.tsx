import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { createClient } from "@/lib/supabase/server";
import { supabaseConfigured } from "@/lib/env";
import { CodeForm } from "./CodeForm";

export const metadata: Metadata = { title: "Verification" };

export default async function MfaPage() {
  if (!supabaseConfigured) redirect("/setup");
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) redirect("/login");

  const { data: level } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (level?.currentLevel === "aal2") redirect("/");

  const { data: factors } = await supabase.auth.mfa.listFactors();
  const factor = factors?.totp[0];
  if (!factor) redirect("/mfa/setup");

  const t = await getTranslations("auth");
  return (
    <>
      <p className="eyebrow">Movia Ops</p>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight">{t("mfaTitle")}</h1>
      <p className="mt-2 text-sm text-muted">{t("mfaLead")}</p>
      <CodeForm factorId={factor.id} />
    </>
  );
}
