import type { ReactNode } from "react";
import Image from "next/image";
import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { Logo } from "@/components/ui/Logo";
import { LocaleSwitch } from "@/components/ops/LocaleSwitch";
import { AskMovia } from "@/features/portal/AskMovia";
import { signOutCustomer } from "@/features/portal/auth-actions";
import { Icon } from "@/features/portal/icons";
import { NotificationBell } from "@/features/portal/NotificationBell";
import { listUnreadConversations } from "@/features/portal/notifications";
import { PortalNav } from "@/features/portal/PortalNav";
import { ProfileMenu } from "@/features/portal/ProfileMenu";
import { banners } from "@/features/portal/ui";
import { requireCustomer } from "@/lib/auth/customer";
import { rootDomain } from "@/lib/env";
import { formatDateTime } from "@/lib/utils/format";

export default async function PortalLayout({ children }: { children: ReactNode }) {
  const session = await requireCustomer();
  const [t, brand, account, locale, unread] = await Promise.all([getTranslations("portal.nav"), getTranslations("portal.brand"), getTranslations("portal.account"), getLocale(), listUnreadConversations(session.customerId)]);
  const dates = Object.fromEntries(unread.map((item) => [item.id, formatDateTime(item.at, locale)]));
  const memberSince = new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en-US", { year: "numeric" }).format(new Date(session.createdAt));
  const bell = <NotificationBell items={unread} dates={dates} />;
  const initial = session.fullName.trim().slice(0, 1).toUpperCase();
  const menuItem = "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[13px] hover:bg-pearl";

  return (
    <div className="portal min-h-dvh lg:grid lg:grid-cols-[15rem_1fr]">
      <aside className="sticky top-0 z-30 border-b border-ink/[0.06] bg-white/95 backdrop-blur lg:h-dvh lg:border-r lg:border-b-0 lg:bg-white">
        <div className="flex h-full flex-col">
          <div className="flex items-center justify-between px-5 pt-4 pb-3 lg:px-6 lg:pt-6 lg:pb-5">
            <Link href="/" aria-label="Movia">
              <Logo />
            </Link>
            <div className="flex items-center gap-1 lg:hidden">
              {bell}
              <LocaleSwitch />
              <form action={signOutCustomer}>
                <button type="submit" className="rounded-pill px-3 py-1.5 text-xs font-medium text-charcoal hover:bg-ink/5">
                  {t("signOut")}
                </button>
              </form>
            </div>
          </div>
          <div className="hidden lg:block">
            <PortalNav orientation="vertical" badges={{ messages: unread.length }} />
          </div>
          <div className="lg:hidden">
            <PortalNav orientation="horizontal" badges={{ messages: unread.length }} />
          </div>
          <div className="relative mt-5 hidden min-h-0 flex-1 lg:block">
            <Image src={banners.home} alt="" fill priority sizes="15rem" className="object-cover object-[62%_center]" />
            <div className="absolute inset-0 bg-gradient-to-b from-white via-white/70 via-25% to-transparent" />
            <p className="absolute top-3 right-5 left-6 text-[10px] leading-relaxed tracking-[0.22em] text-gold uppercase">{brand("tagline2")}</p>
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
          <ProfileMenu initial={initial} name={session.fullName} meta={memberSince ? account("memberSince", { date: memberSince }) : undefined}>
            <Link href="/account" className={menuItem}>
              <Icon name="user" size={15} className="text-gold" />
              {t("viewProfile")}
            </Link>
            <form action={signOutCustomer}>
              <button type="submit" className={`${menuItem} text-status-danger`}>
                <Icon name="x" size={15} />
                {t("signOut")}
              </button>
            </form>
          </ProfileMenu>
        </header>
        <main className="w-full px-5 py-5 sm:px-8">{children}</main>
        <footer className="w-full px-5 pb-8 text-xs text-muted sm:px-8">
          Movia Technologies, Inc. · <a href={`mailto:contact@${rootDomain}`} className="underline decoration-gold/50 underline-offset-4">contact@{rootDomain}</a>
        </footer>
      </div>
      <AskMovia locale={locale === "zh" ? "zh" : "en"} />
    </div>
  );
}
