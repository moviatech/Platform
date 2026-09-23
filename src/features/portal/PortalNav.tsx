"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils/cn";
import { Icon, type IconName } from "./icons";

const items: Array<{ key: string; href: string; icon: IconName }> = [
  { key: "home", href: "/", icon: "home" },
  { key: "trips", href: "/trips", icon: "calendar" },
  { key: "vehicle", href: "/vehicle", icon: "car" },
  { key: "rewards", href: "/rewards", icon: "gift" },
  { key: "messages", href: "/messages", icon: "chat" },
  { key: "help", href: "/help", icon: "help" },
  { key: "account", href: "/account", icon: "user" },
];

export function PortalNav({ orientation, badges = {} }: { orientation: "vertical" | "horizontal"; badges?: Record<string, number> }) {
  const t = useTranslations("portal.nav");
  const pathname = usePathname();
  const vertical = orientation === "vertical";
  return (
    <nav className={cn(vertical ? "flex flex-col gap-1 px-4" : "flex gap-1 overflow-x-auto px-4 pb-3")}>
      {items.map((item) => {
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
      })}
    </nav>
  );
}
