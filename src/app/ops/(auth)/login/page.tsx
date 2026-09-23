import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { supabaseConfigured } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { LoginForm } from "./LoginForm";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage() {
  if (!supabaseConfigured) redirect("/setup");
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (data.user) redirect("/");

  const t = await getTranslations("auth");
  return (
    <>
      <p className="eyebrow">Movia Ops</p>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight">{t("loginTitle")}</h1>
      <p className="mt-2 text-sm text-muted">{t("loginLead")}</p>
      <LoginForm />
    </>
  );
}
