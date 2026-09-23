import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ApplyForm } from "@/features/investor/AuthForms";
import { signOutInvestor } from "@/features/investor/auth-actions";
import { getInvestorAuth } from "@/lib/auth/investor";

export const metadata: Metadata = { title: "Apply" };

export default async function ApplyPage() {
  const auth = await getInvestorAuth();
  if (!auth) redirect("/login");
  if (auth.investor) redirect("/");
  const t = await getTranslations("investor.auth");
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">{t("applyTitle")}</h1>
      <p className="mt-2 text-[13px] text-muted">{t("applyLead", { email: auth.email })}</p>
      <div className="mt-6">
        <ApplyForm />
      </div>
      <form action={signOutInvestor} className="mt-6 text-center">
        <button type="submit" className="text-[13px] text-muted hover:text-ink">
          {t("signOut")}
        </button>
      </form>
    </>
  );
}
