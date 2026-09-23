import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { signOutCustomer } from "@/features/portal/auth-actions";
import { MfaChallenge } from "@/features/portal/MfaForms";
import { getCustomerSession } from "@/lib/auth/customer";
import { safeNext } from "@/lib/auth/next-url";

export const metadata: Metadata = { title: "Verification" };

type Props = { searchParams: Promise<{ next?: string }> };

export default async function VerifyTwoFactorPage({ searchParams }: Props) {
  const { next: rawNext } = await searchParams;
  const next = safeNext(rawNext);
  const session = await getCustomerSession();
  if (!session) redirect("/login");
  if (session.mfaVerified) redirect(next);
  const t = await getTranslations("portal.mfa");
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">{t("challengeTitle")}</h1>
      <div className="mt-6">
        <MfaChallenge next={next} email={session.email} />
      </div>
      <form action={signOutCustomer} className="mt-6 text-center">
        <button type="submit" className="text-[13px] text-muted hover:text-ink">
          {t("signOut")}
        </button>
      </form>
    </>
  );
}
