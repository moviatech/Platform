"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { Icon, type IconName } from "@/features/portal/icons";
import { cn } from "@/lib/utils/cn";

const main: Array<{ key: string; href: string; icon: IconName }> = [
  { key: "home", href: "/", icon: "home" },
  { key: "assets", href: "/assets", icon: "car" },
  { key: "earnings", href: "/earnings", icon: "coins" },
  { key: "funds", href: "/funds", icon: "card" },
  { key: "invest", href: "/invest", icon: "plus" },
  { key: "documents", href: "/documents", icon: "doc" },
];

const secondary: Array<{ key: string; href: string; icon: IconName }> = [
  { key: "messages", href: "/messages", icon: "chat" },
  { key: "account", href: "/account", icon: "user" },
];

export function InvestorNav({ orientation, badges = {} }: { orientation: "vertical" | "horizontal"; badges?: Record<string, number> }) {
  const t = useTranslations("investor.nav");
  const pathname = usePathname();
  const vertical = orientation === "vertical";
  const render = (item: { key: string; href: string; icon: IconName }) => {
    const active = item.href === "/" ? pathname === "/" : pathname === item.href || pathname.startsWith(`${item.href}/`);
    const badge = badges[item.key] ?? 0;
    return (
      <Link
        key={item.key}
        href={item.href}
        className={cn(
          "flex shrink-0 items-center gap-3 rounded-xl text-[14px] font-medium transition-colors",
          vertical ? "px-3.5 py-2.5" : "px-3 py-2 text-[13px]",
          active ? "bg-gold/12 text-ink" : "text-charcoal hover:bg-ink/[0.04]",
        )}
      >
        <span className={cn("relative", active ? "text-gold" : "text-charcoal/70")}>
          <Icon name={item.icon} size={18} />
          {badge > 0 && <span className="absolute -top-0.5 -right-0.5 size-2 rounded-full bg-gold" />}
        </span>
        {t(item.key)}
      </Link>
    );
  };
  if (!vertical) {
    return <nav className="no-scrollbar flex gap-1 overflow-x-auto px-4 pb-3">{[...main, ...secondary].map(render)}</nav>;
  }
  return (
    <nav className="flex flex-col px-4">
      <div className="flex flex-col gap-1">{main.map(render)}</div>
      <div className="mt-3 flex flex-col gap-1 border-t border-ink/[0.06] pt-3">{secondary.map(render)}</div>
    </nav>
  );
}
