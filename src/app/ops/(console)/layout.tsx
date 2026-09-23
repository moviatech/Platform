import type { ReactNode } from "react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Logo } from "@/components/ui/Logo";
import { LocaleSwitch } from "@/components/ops/LocaleSwitch";
import { Sidebar } from "@/components/ops/Sidebar";
import { navGroups } from "@/components/ops/nav";
import { signOut } from "@/features/auth/actions";
import { countOpenConversations } from "@/features/inbox/queries";
import { countOpenLeads } from "@/features/leads/queries";
import { can, getStaffSession } from "@/lib/auth/staff";

export default async function ConsoleLayout({ children }: { children: ReactNode }) {
  const session = await getStaffSession();
  const common = await getTranslations("common");

  const groups = navGroups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => !item.permission || can(session, item.permission)),
    }))
    .filter((group) => group.items.length > 0);

  const [openLeads, unreadInbox] = await Promise.all([
    can(session, "lead.view") ? countOpenLeads() : 0,
    can(session, "inbox.view") ? countOpenConversations() : 0,
  ]);

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[15.5rem_1fr]">
      <aside className="sticky top-0 z-30 border-b border-ink/[0.07] bg-white/90 backdrop-blur lg:h-dvh lg:border-r lg:border-b-0 lg:bg-white">
        <div className="flex h-full flex-col">
          <div className="flex items-center justify-between px-5 pt-4 lg:px-7 lg:pt-6">
            <Link href="/" className="flex flex-col gap-1">
              <Logo />
              <span className="pl-0.5 text-[10px] tracking-[0.24em] text-gold uppercase">{common("ops")}</span>
            </Link>
            <div className="flex items-center gap-1 lg:hidden">
              <LocaleSwitch />
              <form action={signOut}>
                <button type="submit" className="rounded-pill px-3 py-1.5 text-xs font-medium text-charcoal hover:bg-ink/5">
                  {common("signOut")}
                </button>
              </form>
            </div>
          </div>
          <div className="lg:mt-3 lg:flex-1 lg:overflow-y-auto">
            <Sidebar groups={groups} badges={{ leads: openLeads, inbox: unreadInbox }} />
          </div>
          <div className="hidden border-t border-ink/[0.07] p-4 lg:block">
            <div className="flex items-center gap-3 px-2">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-gold/12 text-sm font-medium text-gold">
                {session.displayName.slice(0, 1).toUpperCase()}
              </span>
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{session.displayName}</p>
                <p className="truncate text-xs text-muted">{session.email}</p>
              </div>
            </div>
            <div className="mt-3 flex items-center justify-between">
              <LocaleSwitch />
              <form action={signOut}>
                <button type="submit" className="rounded-pill px-3 py-1.5 text-xs font-medium text-charcoal hover:bg-ink/5">
                  {common("signOut")}
                </button>
              </form>
            </div>
          </div>
        </div>
      </aside>
      <main className="min-w-0 px-5 py-7 sm:px-8 lg:px-12 lg:py-10">
        <div className="mx-auto w-full max-w-[72rem]">{children}</div>
      </main>
    </div>
  );
}
