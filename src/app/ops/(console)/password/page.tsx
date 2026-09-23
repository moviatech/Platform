import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/ops/PageHeader";
import { PasswordForm } from "@/features/auth/PasswordForm";
import { getStaffSession } from "@/lib/auth/staff";

export const metadata: Metadata = { title: "Password" };

export default async function PasswordPage() {
  const [session, t] = await Promise.all([getStaffSession(), getTranslations("auth")]);

  return (
    <>
      <PageHeader eyebrow={session.email} title={t("passwordTitle")} />
      <section className="card max-w-xl p-6">
        <PasswordForm />
      </section>
    </>
  );
}
