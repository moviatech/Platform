import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { pick } from "@/features/portal/content";
import { guides } from "@/features/portal/guides";
import { requireCustomer } from "@/lib/auth/customer";

export const metadata: Metadata = { title: "Guide" };

type Props = { params: Promise<{ slug: string }> };

export default async function GuidePage({ params }: Props) {
  await requireCustomer();
  const { slug } = await params;
  const guide = guides.find((item) => item.slug === slug);
  if (!guide) notFound();
  const [t, locale] = await Promise.all([getTranslations("portal.help"), getLocale()]);

  return (
    <>
      <Link href="/help" className="mb-4 inline-block text-[13px] text-muted hover:text-ink">
        ← {t("title")}
      </Link>
      <article className="card overflow-hidden">
        <div className="relative aspect-[21/9] bg-pearl">
          <Image src={guide.image} alt="" fill sizes="(min-width: 1024px) 60rem, 100vw" className="object-cover" priority />
          {guide.kind === "video" && (
            <span className="absolute right-4 bottom-4 rounded-pill bg-white/90 px-3 py-1 text-[12px] font-medium text-ink">{t("videoSoon")}</span>
          )}
        </div>
        <div className="p-6 sm:p-8">
          <p className="text-[11px] tracking-[0.2em] text-gold uppercase">{t(`kinds.${guide.kind}`)}</p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight">{pick(guide.title, locale)}</h1>
          <p className="mt-2 text-[15px] text-charcoal">{pick(guide.summary, locale)}</p>
          <p className="mt-6 text-[14px] leading-relaxed whitespace-pre-wrap text-charcoal">{pick(guide.body, locale)}</p>
        </div>
      </article>
    </>
  );
}
