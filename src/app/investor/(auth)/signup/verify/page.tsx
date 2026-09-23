import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { SignupVerifyForm } from "@/features/investor/AuthForms";
import { getInvestorAuth } from "@/lib/auth/investor";

export const metadata: Metadata = { title: "Verify email" };

type Props = { searchParams: Promise<{ email?: string }> };

export default async function SignupVerifyPage({ searchParams }: Props) {
  const { email } = await searchParams;
  if (await getInvestorAuth()) redirect("/");
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) redirect("/signup");
  const t = await getTranslations("investor.auth");
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">{t("verifyTitle")}</h1>
      <p className="mt-2 text-[13px] text-muted">{t("verifyLead", { email })}</p>
      <div className="mt-6">
        <SignupVerifyForm email={email.toLowerCase()} />
      </div>
    </>
  );
}
