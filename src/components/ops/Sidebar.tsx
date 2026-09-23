"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils/cn";
import type { NavGroup } from "./nav";

type Props = {
  groups: NavGroup[];
  badges?: Record<string, number>;
};

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

export function Sidebar({ groups, badges = {} }: Props) {
  const t = useTranslations("nav");
  const common = useTranslations("common");
  const pathname = usePathname();

  return (
    <nav className="no-scrollbar flex gap-1 overflow-x-auto px-3 py-2 lg:flex-col lg:gap-0 lg:overflow-visible lg:px-4 lg:py-4">
      {groups.map((group, index) => (
        <div key={group.key ?? index} className={cn("flex shrink-0 gap-1 lg:flex-col lg:gap-0.5", index > 0 && "lg:mt-3 lg:border-t lg:border-ink/[0.08] lg:pt-3")}>
          {group.key && <p className="hidden px-3 pt-1 pb-2 text-[12px] font-semibold tracking-[0.1em] text-ink uppercase lg:block">{t(group.key)}</p>}
          {group.items.map((item) => {
            const count = badges[item.key];
            if (!item.href) {
              return (
                <span
                  key={item.key}
                  aria-disabled="true"
                  title={common("soon")}
                  className="hidden items-center justify-between rounded-xl px-3 py-2 text-sm text-muted/60 lg:flex"
                >
                  {t(item.key)}
                  <span className="text-[10px] tracking-wide text-muted/50">{common("soon")}</span>
                </span>
              );
            }
            const active = isActive(pathname, item.href);
            return (
              <Link
                key={item.key}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative flex shrink-0 items-center justify-between gap-3 rounded-xl px-3 py-2 text-sm transition-colors",
                  active ? "bg-ink/[0.045] font-medium text-ink" : "text-charcoal hover:bg-ink/[0.03]",
                )}
              >
                {active && <span aria-hidden="true" className="absolute left-0 top-1/2 hidden h-4 w-[3px] -translate-y-1/2 rounded-full bg-gold lg:block" />}
                {t(item.key)}
                {count ? (
                  <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-pill bg-gold px-1.5 text-[11px] font-medium text-white">
                    {count > 99 ? "99+" : count}
                  </span>
                ) : null}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
