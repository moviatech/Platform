import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { SignUpForm } from "@/features/portal/AuthForms";
import { getCustomerSession } from "@/lib/auth/customer";
import { safeNext, withNext } from "@/lib/auth/next-url";

export const metadata: Metadata = { title: "Sign up" };

type Props = { searchParams: Promise<{ next?: string }> };

export default async function SignUpPage({ searchParams }: Props) {
  const next = safeNext((await searchParams).next);
  if (await getCustomerSession()) redirect(next);
  const t = await getTranslations("portal.auth");
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">{t("signUpTitle")}</h1>
      <div className="mt-6">
        <SignUpForm next={next} />
      </div>
      <p className="mt-6 text-center text-[13px] text-muted">
        {t("haveAccount")}{" "}
        <Link href={withNext("/login", next)} className="text-ink underline decoration-gold/50 underline-offset-4 hover:decoration-gold">
          {t("signIn")}
        </Link>
      </p>
    </>
  );
}
