import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { signOutInvestor } from "@/features/investor/auth-actions";
import { getInvestorAuth } from "@/lib/auth/investor";
import { rootDomain } from "@/lib/env";

export const metadata: Metadata = { title: "Application status" };

export default async function PendingPage() {
  const auth = await getInvestorAuth();
  if (!auth) redirect("/login");
  if (!auth.investor) redirect("/apply");
  if (auth.investor.status === "ACTIVE") redirect("/");
  const t = await getTranslations("investor.pending");
  const status = auth.investor.status;
  return (
    <>
      <p className="eyebrow mb-2">{auth.investor.investor_number}</p>
      <h1 className="text-2xl font-semibold tracking-tight">{t(`${status}.title`)}</h1>
      <p className="mt-3 text-[14px] leading-relaxed text-charcoal">{t(`${status}.body`, { name: auth.investor.legal_name })}</p>
      <p className="mt-4 text-[13px] text-muted">
        <a href={`mailto:contact@${rootDomain}`} className="underline decoration-gold/50 underline-offset-4">
          contact@{rootDomain}
        </a>
      </p>
      <form action={signOutInvestor} className="mt-8 text-center">
        <button type="submit" className="text-[13px] text-muted hover:text-ink">
          {t("signOut")}
        </button>
      </form>
    </>
  );
}
