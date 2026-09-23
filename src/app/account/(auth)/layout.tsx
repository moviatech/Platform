import type { ReactNode } from "react";
import { Logo } from "@/components/ui/Logo";
import { LocaleSwitch } from "@/components/ops/LocaleSwitch";

export default function PortalAuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="relative flex min-h-dvh flex-col items-center justify-center px-5 py-12">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-[radial-gradient(60rem_32rem_at_50%_-8rem,rgba(181,139,75,0.10),transparent_70%)]" />
      <div className="relative w-full max-w-[26rem]">
        <div className="mb-8 flex items-center justify-between">
          <Logo />
          <LocaleSwitch />
        </div>
        <div className="card p-7 sm:p-8">{children}</div>
      </div>
    </main>
  );
}
