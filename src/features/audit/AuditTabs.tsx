import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { cn } from "@/lib/utils/cn";

export async function AuditTabs({ current }: { current: "events" | "emails" }) {
  const t = await getTranslations("audit");
  const tabs = [
    { key: "events", href: "/audit", label: t("tabs.events") },
    { key: "emails", href: "/audit/emails", label: t("tabs.emails") },
  ] as const;
  return (
    <nav className="mb-5 flex gap-2">
      {tabs.map((tab) => (
        <Link key={tab.key} href={tab.href} aria-current={tab.key === current ? "page" : undefined} className={cn("rounded-pill px-3.5 py-1.5 text-[13px] hairline hover:border-ink/25", tab.key === current && "bg-ink text-white")}>
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}
