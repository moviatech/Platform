import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { VerifyForm } from "@/features/portal/AuthForms";
import { safeNext, withNext } from "@/lib/auth/next-url";

export const metadata: Metadata = { title: "Enter code" };

type Props = { searchParams: Promise<{ email?: string; next?: string }> };

export default async function VerifyPage({ searchParams }: Props) {
  const { email, next: rawNext } = await searchParams;
  const next = safeNext(rawNext);
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) redirect(withNext("/login/code", next));
  const t = await getTranslations("portal.auth");
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">{t("codeTitle")}</h1>
      <p className="mt-2 text-sm text-muted">{email}</p>
      <div className="mt-6">
        <VerifyForm email={email} next={next} />
      </div>
    </>
  );
}
