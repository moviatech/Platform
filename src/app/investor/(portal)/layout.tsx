import type { ReactNode } from "react";
import Image from "next/image";
import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { Logo } from "@/components/ui/Logo";
import { LocaleSwitch } from "@/components/ops/LocaleSwitch";
import { signOutInvestor } from "@/features/investor/auth-actions";
import { InvestorNav } from "@/features/investor/InvestorNav";
import { listInvestorBell } from "@/features/investor/notifications";
import { Icon } from "@/features/portal/icons";
import { NotificationBell } from "@/features/portal/NotificationBell";
import { ProfileMenu } from "@/features/portal/ProfileMenu";
import { TitleGuard } from "@/features/portal/TitleGuard";
import { requireInvestor } from "@/lib/auth/investor";
import { rootDomain } from "@/lib/env";
import { formatDateTime } from "@/lib/utils/format";

export default async function InvestorPortalLayout({ children }: { children: ReactNode }) {
  const session = await requireInvestor();
  const [t, brand, locale, kinds] = await Promise.all([getTranslations("investor.nav"), getTranslations("investor.brand"), getLocale(), getTranslations("investor.notifications.kinds")]);
  const unread = await listInvestorBell(session.investorId, locale, (kind, params) => (kinds.has(kind) ? kinds(kind, params) : kind));
  const dates = Object.fromEntries(unread.map((item) => [item.id, formatDateTime(item.at)]));
  const bell = <NotificationBell items={unread} dates={dates} allHref={unread.some((item) => item.href.startsWith("/notifications/")) ? "/messages?status=notifications" : "/messages"} />;
  const initial = session.legalName.trim().slice(0, 1).toUpperCase();
  const menuItem = "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[13px] hover:bg-pearl";

  return (
    <div className="portal min-h-dvh lg:grid lg:grid-cols-[15rem_1fr]">
      <aside className="sticky top-0 z-30 border-b border-ink/[0.06] bg-white/95 backdrop-blur lg:h-dvh lg:border-r lg:border-b-0 lg:bg-white">
        <div className="flex h-full flex-col">
          <div className="flex items-center justify-between px-5 pt-4 pb-3 lg:px-6 lg:pt-6 lg:pb-5">
            <Link href="/" aria-label="Movia" className="flex flex-col gap-1">
              <Logo />
              <span className="pl-0.5 text-[10px] tracking-[0.24em] text-gold uppercase">{brand("portal")}</span>
            </Link>
            <div className="flex items-center gap-1 lg:hidden">
              {bell}
              <LocaleSwitch />
              <form action={signOutInvestor}>
                <button type="submit" className="rounded-pill px-3 py-1.5 text-xs font-medium text-charcoal hover:bg-ink/5">
                  {t("signOut")}
                </button>
              </form>
            </div>
          </div>
          <div className="hidden min-h-0 flex-1 lg:flex lg:flex-col">
            <InvestorNav orientation="vertical" badges={{ messages: unread.length }} />
            <div className="relative mt-5 min-h-0 flex-1">
              <Image src="/portal/banners/sidebar.webp" alt="" fill priority sizes="15rem" className="object-cover object-bottom" />
              <div className="absolute inset-0 bg-gradient-to-b from-white via-white/70 via-25% to-transparent" />
              <p className="absolute top-3 right-5 left-6 text-[10px] leading-relaxed tracking-[0.22em] text-gold uppercase">{brand("tagline")}</p>
            </div>
          </div>
          <div className="lg:hidden">
            <InvestorNav orientation="horizontal" badges={{ messages: unread.length }} />
          </div>
        </div>
      </aside>
      <div className="min-w-0">
        <header className="hidden items-center justify-end gap-2 px-8 pt-4 lg:flex">
          <span className="flex items-center gap-1 rounded-pill bg-white px-2 py-0.5 text-charcoal hairline">
            <Icon name="globe" size={15} className="text-charcoal/70" />
            <LocaleSwitch />
          </span>
          {bell}
          <ProfileMenu initial={initial} name={session.legalName} meta={session.number}>
            <Link href="/account" className={menuItem}>
              <Icon name="user" size={15} className="text-gold" />
              {t("viewProfile")}
            </Link>
            <form action={signOutInvestor}>
              <button type="submit" className={`${menuItem} text-status-danger`}>
                <Icon name="x" size={15} />
                {t("signOut")}
              </button>
            </form>
          </ProfileMenu>
        </header>
        <main className="w-full px-5 py-5 sm:px-8">
          <TitleGuard />
          {children}
        </main>
        <footer className="w-full px-5 pb-8 text-xs text-muted sm:px-8">
          Movia Technologies, Inc. · <a href={`mailto:contact@${rootDomain}`} className="underline decoration-gold/50 underline-offset-4">contact@{rootDomain}</a>
        </footer>
      </div>
    </div>
  );
}
