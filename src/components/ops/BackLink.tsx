import Link from "next/link";
import { getTranslations } from "next-intl/server";

export function safeBack(value: string | string[] | undefined, fallback: string) {
  const candidate = Array.isArray(value) ? value[0] : value;
  return candidate && candidate.startsWith("/") && !candidate.startsWith("//") && candidate.length < 400 ? candidate : fallback;
}

export function withBack(href: string, back: string) {
  return `${href}${href.includes("?") ? "&" : "?"}back=${encodeURIComponent(back)}`;
}

export async function BackLink({ href }: { href: string }) {
  const t = await getTranslations("common");
  return (
    <Link href={href} className="mb-4 inline-block text-[13px] text-muted hover:text-ink">
      ← {t("back")}
    </Link>
  );
}
