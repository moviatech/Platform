import type { ReactNode } from "react";
import { getTranslations } from "next-intl/server";
import { Logo } from "@/components/ui/Logo";
import { LocaleSwitch } from "@/components/ops/LocaleSwitch";

export default async function InvestorAuthLayout({ children }: { children: ReactNode }) {
  const t = await getTranslations("investor.brand");
  return (
    <main className="relative flex min-h-dvh flex-col items-center justify-center px-5 py-12">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-[radial-gradient(60rem_32rem_at_50%_-8rem,rgba(181,139,75,0.10),transparent_70%)]" />
      <div className="relative w-full max-w-[26rem]">
        <div className="mb-8 flex items-center justify-between">
          <span className="flex flex-col gap-1">
            <Logo />
            <span className="pl-0.5 text-[10px] tracking-[0.24em] text-gold uppercase">{t("portal")}</span>
          </span>
          <LocaleSwitch />
        </div>
        <div className="card p-7 sm:p-8">{children}</div>
      </div>
    </main>
  );
}
