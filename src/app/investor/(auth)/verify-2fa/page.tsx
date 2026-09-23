import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { InvestorMfaChallenge } from "@/features/investor/AuthForms";
import { signOutInvestor } from "@/features/investor/auth-actions";
import { getInvestorAuth } from "@/lib/auth/investor";

export const metadata: Metadata = { title: "Verification" };

export default async function InvestorVerifyPage() {
  const auth = await getInvestorAuth();
  if (!auth) redirect("/login");
  if (!auth.investor) redirect("/apply");
  if (auth.investor.status !== "ACTIVE") redirect("/pending");
  if (auth.mfaVerified) redirect("/");
  const t = await getTranslations("investor.mfa");
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
      <div className="mt-6">
        <InvestorMfaChallenge email={auth.investor.email} />
      </div>
      <form action={signOutInvestor} className="mt-6 text-center">
        <button type="submit" className="text-[13px] text-muted hover:text-ink">
          {t("signOut")}
        </button>
      </form>
    </>
  );
}
