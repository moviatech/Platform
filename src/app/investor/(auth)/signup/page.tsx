import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { InvestorSignUpForm } from "@/features/investor/AuthForms";
import { getInvestorAuth } from "@/lib/auth/investor";

export const metadata: Metadata = { title: "Investor sign up" };

export default async function InvestorSignUpPage() {
  if (await getInvestorAuth()) redirect("/");
  const t = await getTranslations("investor.auth");
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">{t("signUpTitle")}</h1>
      <p className="mt-2 text-[13px] text-muted">{t("signUpLead")}</p>
      <div className="mt-6">
        <InvestorSignUpForm />
      </div>
      <p className="mt-6 text-center text-[13px] text-muted">
        {t("haveAccount")}{" "}
        <Link href="/login" className="text-ink underline decoration-gold/50 underline-offset-4 hover:decoration-gold">
          {t("signIn")}
        </Link>
      </p>
    </>
  );
}
