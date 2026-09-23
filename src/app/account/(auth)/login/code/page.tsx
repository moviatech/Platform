import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { CodeRequestForm } from "@/features/portal/AuthForms";
import { getCustomerSession } from "@/lib/auth/customer";
import { safeNext, withNext } from "@/lib/auth/next-url";

export const metadata: Metadata = { title: "Login" };

type Props = { searchParams: Promise<{ next?: string }> };

export default async function CodeLoginPage({ searchParams }: Props) {
  const next = safeNext((await searchParams).next);
  if (await getCustomerSession()) redirect(next);
  const t = await getTranslations("portal.auth");
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">{t("codeLoginTitle")}</h1>
      <div className="mt-6">
        <CodeRequestForm next={next} />
      </div>
      <p className="mt-6 text-center text-[13px]">
        <Link href={withNext("/login", next)} className="text-muted hover:text-ink">
          {t("backToLogin")}
        </Link>
      </p>
    </>
  );
}
