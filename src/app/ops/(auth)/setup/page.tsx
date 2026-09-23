import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { supabaseConfigured } from "@/lib/env";

export const metadata: Metadata = { title: "Setup" };

export default async function SetupPage() {
  if (supabaseConfigured) redirect("/login");
  const t = await getTranslations("auth");
  return (
    <>
      <p className="eyebrow">Movia Ops</p>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight">{t("setupTitle")}</h1>
      <p className="mt-2 text-sm text-muted">{t("setupLead")}</p>
    </>
  );
}
