import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { cn } from "@/lib/utils/cn";

const tabs = [
  ["orders", "/finance"],
  ["report", "/finance/report"],
  ["expenses", "/finance/expenses"],
  ["stripe", "/finance/stripe"],
  ["owners", "/finance/owners"],
] as const;

export async function FinanceTabs({ current }: { current: (typeof tabs)[number][0] }) {
  const t = await getTranslations("finance.tabs");
  return (
    <nav className="mb-5 flex flex-wrap gap-2">
      {tabs.map(([key, href]) => (
        <Link key={key} href={href} aria-current={key === current ? "page" : undefined} className={cn("rounded-pill px-3.5 py-1.5 text-[13px] hairline hover:border-ink/25", key === current && "bg-ink text-white")}>
          {t(key)}
        </Link>
      ))}
    </nav>
  );
}
