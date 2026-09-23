import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { ForgotForm } from "@/features/portal/AuthForms";

export const metadata: Metadata = { title: "Reset password" };

type Props = { searchParams: Promise<{ sent?: string }> };

export default async function ForgotPage({ searchParams }: Props) {
  const { sent } = await searchParams;
  const t = await getTranslations("portal.auth");
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">{t("forgotTitle")}</h1>
      <div className="mt-6">{sent ? <p className="rounded-xl bg-status-available/10 px-4 py-3 text-sm">{t("resetSent")}</p> : <ForgotForm />}</div>
      <p className="mt-6 text-center text-[13px]">
        <Link href="/login" className="text-muted hover:text-ink">
          {t("backToLogin")}
        </Link>
      </p>
    </>
  );
}
