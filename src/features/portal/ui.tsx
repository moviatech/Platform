import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils/cn";
import { pick, type PortalContent } from "./content";
import { classImage } from "./garage";
import { Icon, type IconName } from "./icons";
import type { Recommendation } from "./recommendations";

export const banners = { home: "/portal/banners/banner-1.webp", front: "/portal/banners/banner-2.webp", interior: "/portal/banners/banner-3.webp" } as const;
export const bannerThumbs = { home: "/portal/banners/banner-1-md.webp", front: "/portal/banners/banner-2-md.webp", interior: "/portal/banners/banner-3-md.webp" } as const;

export const pill = "inline-flex h-10 items-center justify-center gap-1.5 rounded-pill px-4 text-[13px] font-medium transition-colors";
export const goldPill = `${pill} bg-gold text-white hover:bg-gold-light`;
export const whitePill = `${pill} bg-white text-ink border border-gold/40 hover:border-gold`;
export const ghostPill = `${pill} border border-white/50 text-white hover:bg-white/10`;

export function Brandline({ lines, light, className }: { lines: [string, string]; light?: boolean; className?: string }) {
  return (
    <p className={cn("text-[10px] leading-[1.7] tracking-[0.24em] uppercase", light ? "text-white/85" : "text-gold", className)}>
      <span className="mb-1.5 block h-px w-8 bg-current opacity-60" />
      {lines[0]}
      <br />
      {lines[1]}
    </p>
  );
}

export function PageIntro({ eyebrow, title, subtitle, tagline, actions }: { eyebrow?: string; title: string; subtitle?: string; tagline?: [string, string]; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
      <div>
        {eyebrow && <p className="eyebrow mb-2">{eyebrow}</p>}
        <h1 className="text-[2rem] leading-tight font-medium tracking-tight sm:text-[2.35rem]">{title}</h1>
        {subtitle && <p className="mt-1.5 text-[15px] text-muted">{subtitle}</p>}
      </div>
      {actions ?? (tagline && <Brandline lines={tagline} className="hidden text-right lg:block [&>span]:ml-auto" />)}
    </div>
  );
}

export function SectionHeading({ title, subtitle, href, more, icon }: { title: string; subtitle?: string; href?: string; more?: string; icon?: IconName }) {
  return (
    <div className="mb-4 flex items-start justify-between gap-4">
      <div className="flex items-start gap-3">
        {icon && (
          <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl bg-gold/10 text-gold">
            <Icon name={icon} size={17} />
          </span>
        )}
        <div>
          <h2 className="text-[17px] font-semibold tracking-tight">{title}</h2>
          {subtitle && <p className="text-[13px] text-muted">{subtitle}</p>}
        </div>
      </div>
      {href && more && (
        <Link href={href} className="flex shrink-0 items-center gap-1 text-[13px] font-medium text-gold hover:text-gold-light">
          {more}
          <Icon name="arrow" size={14} />
        </Link>
      )}
    </div>
  );
}

export function VehicleVisual({ slug, cover, className, priority, sizes, children }: { slug?: string | null; cover?: string | null; className?: string; priority?: boolean; sizes?: string; children?: ReactNode }) {
  if (cover) {
    return (
      <div className={cn("relative overflow-hidden bg-ink", className)}>
        <Image src={cover} alt="" fill unoptimized sizes={sizes ?? "40rem"} className="object-cover" priority={priority} />
        {children}
      </div>
    );
  }
  return (
    <div className={cn("relative overflow-hidden bg-[radial-gradient(120%_90%_at_50%_100%,#ece2cf_0%,#f7f3ec_50%,#fbfaf7_100%)]", className)}>
      <div className="absolute inset-x-[12%] bottom-[12%] h-[10%] rounded-[50%] bg-ink/15 blur-2xl" />
      <Image src={classImage(slug)} alt="" fill sizes={sizes ?? "40rem"} className="object-contain p-[7%]" priority={priority} />
      {children}
    </div>
  );
}

export function IconBadge({ name, size = 8, className }: { name: IconName; size?: 8 | 9 | 10; className?: string }) {
  const sizes = { 8: "size-8", 9: "size-9", 10: "size-10" };
  return (
    <span className={cn("flex shrink-0 items-center justify-center rounded-full bg-gold/10 text-gold", sizes[size], className)}>
      <Icon name={name} size={size === 8 ? 15 : 17} />
    </span>
  );
}

export function DetailRow({ icon, label, value, sub, tone }: { icon: IconName; label: string; value: ReactNode; sub?: ReactNode; tone?: "gold" }) {
  return (
    <div className="flex items-start gap-2">
      <Icon name={icon} size={18} className="mt-0.5 shrink-0 text-gold" />
      <span className="min-w-0">
        <span className="block text-[12px] text-muted">{label}</span>
        <span className={cn("block truncate text-[14px] font-semibold", tone === "gold" && "text-gold")}>{value}</span>
        {sub && <span className="block truncate text-[12px] text-muted">{sub}</span>}
      </span>
    </div>
  );
}

export function RecoList({ items }: { items: Recommendation[] }) {
  const className = "flex items-center gap-3.5 py-3 first:pt-0 last:pb-0 hover:text-gold";
  return (
    <ul className="flex flex-col divide-y divide-ink/[0.06]">
      {items.map((item) => {
        const inner = (
          <>
            <span className="relative h-16 w-24 shrink-0 overflow-hidden rounded-lg bg-pearl">
              <Image src={item.image} alt="" fill unoptimized={item.external} sizes="6rem" className="object-cover" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="line-clamp-2 text-[13px] leading-snug font-semibold">{item.title}</span>
              {item.summary && <span className="block truncate text-[12px] text-muted">{item.summary}</span>}
            </span>
            <Icon name="chevron" size={14} className="shrink-0 text-muted" />
          </>
        );
        return (
          <li key={item.key}>
            {item.external ? (
              <a href={item.href} target="_blank" rel="noreferrer" className={className}>
                {inner}
              </a>
            ) : (
              <Link href={item.href} className={className}>
                {inner}
              </Link>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export function RecoGrid({ items }: { items: Recommendation[] }) {
  return (
    <ul className="grid grid-cols-3 gap-4">
      {items.map((item) => {
        const inner = (
          <>
            <span className="relative block aspect-[4/3] w-full overflow-hidden rounded-xl bg-pearl">
              <Image src={item.image} alt="" fill unoptimized={item.external} sizes="9rem" className="object-cover transition-transform duration-500 group-hover:scale-[1.04]" />
            </span>
            {item.category ? (
              <span className="mt-2.5 block text-[10px] tracking-[0.18em] text-gold uppercase">{item.summary}</span>
            ) : (
              <span className="mt-2.5 block truncate text-[11px] text-muted">{item.summary}</span>
            )}
            <span className="mt-1 line-clamp-2 text-[12px] leading-snug font-semibold group-hover:text-gold">{item.title}</span>
          </>
        );
        return (
          <li key={item.key}>
            {item.external ? (
              <a href={item.href} target="_blank" rel="noreferrer" className="group block">
                {inner}
              </a>
            ) : (
              <Link href={item.href} className="group block">
                {inner}
              </Link>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export function ListLink({ href, icon, label, meta, sub }: { href: string; icon: IconName; label: string; meta?: ReactNode; sub?: string }) {
  return (
    <Link href={href} className="flex items-center gap-3 rounded-xl px-2 py-2.5 text-[13px] transition-colors hover:bg-pearl">
      <IconBadge name={icon} />
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">{label}</span>
        {sub && <span className="block truncate text-[12px] text-muted">{sub}</span>}
      </span>
      {meta && <span className="shrink-0 text-[12px] text-muted">{meta}</span>}
      <Icon name="chevron" size={14} className="text-muted" />
    </Link>
  );
}

export function StatCard({ icon, label, value, body, href, more }: { icon: IconName; label: string; value: ReactNode; body: string; href: string; more: string }) {
  return (
    <section className="card flex items-start gap-4 p-5">
      <IconBadge name={icon} size={10} />
      <div className="min-w-0 flex-1">
        <p className="text-[13px] text-muted">{label}</p>
        <p className="mt-0.5 text-[1.6rem] leading-tight font-semibold tracking-tight">{value}</p>
        <div className="mt-1 flex items-center justify-between gap-3 text-[12px]">
          <span className="text-muted">{body}</span>
          <Link href={href} className="flex shrink-0 items-center gap-1 font-medium text-gold hover:text-gold-light">
            {more}
            <Icon name="arrow" size={13} />
          </Link>
        </div>
      </div>
    </section>
  );
}

export function Tile({ href, label, title, body, className }: { href: string; label: string; title: ReactNode; body?: ReactNode; className?: string }) {
  return (
    <Link href={href} className={cn("card flex min-h-36 flex-col justify-between p-5 transition-shadow hover:shadow-lift", className)}>
      <span className="text-[11px] tracking-[0.2em] text-gold uppercase">{label}</span>
      <span>
        <span className="block text-lg font-semibold tracking-tight">{title}</span>
        {body && <span className="mt-1 block text-[13px] text-muted">{body}</span>}
      </span>
    </Link>
  );
}

const linkIcons: Record<string, string> = {
  youtube: "M21.6 7.2a2.7 2.7 0 0 0-1.9-1.9C18 4.8 12 4.8 12 4.8s-6 0-7.7.5A2.7 2.7 0 0 0 2.4 7.2 28 28 0 0 0 2 12a28 28 0 0 0 .4 4.8 2.7 2.7 0 0 0 1.9 1.9c1.7.5 7.7.5 7.7.5s6 0 7.7-.5a2.7 2.7 0 0 0 1.9-1.9A28 28 0 0 0 22 12a28 28 0 0 0-.4-4.8zM10 15V9l5.2 3z",
  site: "M7 17 17 7M8 7h9v9",
};

export function LinkList({ links, locale }: { links: PortalContent["links"]; locale: string }) {
  return (
    <ul className="flex flex-col gap-2">
      {links.map((link, index) => (
        <li key={index}>
          <a href={link.url} target="_blank" rel="noreferrer" className="card flex items-center gap-3 px-4 py-3 text-[14px] transition-shadow hover:shadow-lift">
            <svg width="20" height="20" viewBox="0 0 24 24" fill={link.kind === "youtube" ? "#e0302d" : "none"} stroke={link.kind === "youtube" ? "none" : "currentColor"} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="shrink-0">
              <path d={linkIcons[link.kind]} />
            </svg>
            <span className="min-w-0 flex-1 truncate">{pick(link.label, locale)}</span>
          </a>
        </li>
      ))}
    </ul>
  );
}

export function ContactCard({ contact, locale, labels }: { contact: PortalContent["contact"]; locale: string; labels: { title: string; phone: string; wechat: string; email: string; hours: string } }) {
  const rows: Array<{ icon: IconName; label: string; value: ReactNode }> = [];
  if (contact.phone) rows.push({ icon: "phone", label: labels.phone, value: <a href={`tel:${contact.phone.replace(/[^+\d]/g, "")}`} className="hover:text-gold">{contact.phone}</a> });
  if (contact.wechat) rows.push({ icon: "chat", label: labels.wechat, value: contact.wechat });
  if (contact.email) rows.push({ icon: "mail", label: labels.email, value: <a href={`mailto:${contact.email}`} className="hover:text-gold">{contact.email}</a> });
  const hours = pick(contact.hours, locale);
  if (hours) rows.push({ icon: "clock", label: labels.hours, value: hours });
  return (
    <section className="card p-5">
      <h2 className="text-[15px] font-semibold">{labels.title}</h2>
      <ul className="mt-3 flex flex-col gap-3">
        {rows.map((row) => (
          <li key={row.label} className="flex items-center gap-3 text-[13px]">
            <IconBadge name={row.icon} />
            <span className="min-w-0">
              <span className="block text-[11px] text-muted">{row.label}</span>
              <span className="block font-medium">{row.value}</span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
