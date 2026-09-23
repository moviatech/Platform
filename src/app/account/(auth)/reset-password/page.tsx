import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ResetForm } from "@/features/portal/AuthForms";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "New password" };

export default async function ResetPasswordPage() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect("/login?error=link");
  const t = await getTranslations("portal.auth");
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">{t("resetTitle")}</h1>
      <div className="mt-6">
        <ResetForm />
      </div>
    </>
  );
}
