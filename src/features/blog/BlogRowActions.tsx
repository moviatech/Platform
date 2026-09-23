"use client";

import { useTransition } from "react";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { clearFeatured, hidePost, restorePost, setFeatured } from "./actions";

type Props = { slug: string; featured: boolean; hidden: boolean; canFeature: boolean };

export function FeaturedToggle({ slug, featured, hidden, canFeature }: Props) {
  const t = useTranslations("blog");
  const [pending, start] = useTransition();
  if (hidden) return <span className="text-muted">—</span>;
  return (
    <span className="flex items-center gap-2">
      {featured && <Badge tone="gold">{t("featured")}</Badge>}
      <Button type="button" size="sm" variant="ghost" className="h-7 px-2.5 text-xs" disabled={pending || (!featured && !canFeature)} onClick={() => start(() => (featured ? clearFeatured(slug) : setFeatured(slug)))}>
        {featured ? t("unfeature") : t("feature")}
      </Button>
    </span>
  );
}

export function VisibilityToggle({ slug, hidden }: Pick<Props, "slug" | "hidden">) {
  const t = useTranslations("blog");
  const [pending, start] = useTransition();
  return (
    <Button type="button" size="sm" variant={hidden ? "secondary" : "danger"} className="h-7 px-2.5 text-xs" disabled={pending} onClick={() => start(() => (hidden ? restorePost(slug) : hidePost(slug)))}>
      {hidden ? t("restore") : t("hide")}
    </Button>
  );
}
