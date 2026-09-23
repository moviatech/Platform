import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { cn } from "@/lib/utils/cn";

type Props = { active: "conversations" | "handoffs"; handoffCount: number; showHandoffs: boolean };

export async function InboxTabs({ active, handoffCount, showHandoffs }: Props) {
  const t = await getTranslations("inbox");
  const tabs = [
    { key: "conversations" as const, label: t("tabs.conversations"), href: "/inbox", count: 0 },
    ...(showHandoffs ? [{ key: "handoffs" as const, label: t("tabs.handoffs"), href: "/inbox?view=handoffs", count: handoffCount }] : []),
  ];

  return (
    <div className="mb-4 flex gap-1.5">
      {tabs.map((tab) => (
        <Link
          key={tab.key}
          href={tab.href}
          className={cn(
            "inline-flex items-center gap-2 rounded-pill px-3.5 py-1.5 text-[13px] transition-colors",
            tab.key === active ? "bg-ink text-white" : "bg-white text-charcoal hairline hover:border-ink/20",
          )}
        >
          {tab.label}
          {tab.count > 0 && (
            <span className={cn("inline-flex h-5 min-w-5 items-center justify-center rounded-pill px-1.5 text-[11px] font-medium", tab.key === active ? "bg-white/20 text-white" : "bg-gold text-white")}>
              {tab.count}
            </span>
          )}
        </Link>
      ))}
    </div>
  );
}
