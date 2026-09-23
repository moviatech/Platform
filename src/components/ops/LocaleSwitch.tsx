"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { setLocale } from "@/features/auth/actions";
import { cn } from "@/lib/utils/cn";

export function LocaleSwitch({ className, label }: { className?: string; label?: string }) {
  const locale = useLocale();
  const t = useTranslations("common");
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          await setLocale(locale === "zh" ? "en" : "zh");
          router.refresh();
        })
      }
      className={cn("rounded-pill px-3 py-1.5 text-xs font-medium text-charcoal transition-colors hover:bg-ink/5", className)}
    >
      {label ?? t("language")}
    </button>
  );
}
