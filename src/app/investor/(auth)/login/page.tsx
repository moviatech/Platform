import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { InvestorLoginForm } from "@/features/investor/AuthForms";
import { getInvestorAuth } from "@/lib/auth/investor";

export const metadata: Metadata = { title: "Investor login" };

type Props = { searchParams: Promise<{ error?: string }> };

export default async function InvestorLoginPage({ searchParams }: Props) {
  const { error } = await searchParams;
  if (await getInvestorAuth()) redirect("/");
  const t = await getTranslations("investor.auth");
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
      {(error === "link" || error === "expired") && (
        <p className="mt-4 rounded-xl bg-status-danger/8 px-3.5 py-2.5 text-[13px] text-status-danger" role="alert">
          {t(error === "link" ? "errors.session" : "errors.expired")}
        </p>
      )}
      <div className="mt-6">
        <InvestorLoginForm />
      </div>
      <p className="mt-6 text-center text-[13px] text-muted">
        {t("noAccount")}{" "}
        <Link href="/signup" className="text-ink underline decoration-gold/50 underline-offset-4 hover:decoration-gold">
          {t("signUp")}
        </Link>
      </p>
    </>
  );
}
