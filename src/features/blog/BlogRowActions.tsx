"use client";

import { useTransition } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { clearFeatured, hidePost, restorePost, setFeatured } from "./actions";

type Labels = { featured: string; feature: string; unfeature: string; hide: string; restore: string };

export function FeaturedToggle({ slug, featured, canFeature, labels }: { slug: string; featured: boolean; canFeature: boolean; labels: Labels }) {
  const [pending, start] = useTransition();
  return (
    <span className="flex items-center gap-2">
      {featured && <Badge tone="gold">{labels.featured}</Badge>}
      <Button type="button" size="sm" variant="ghost" className="h-7 px-2.5 text-xs" disabled={pending || (!featured && !canFeature)} onClick={() => start(() => (featured ? clearFeatured(slug) : setFeatured(slug)).catch(() => undefined))}>
        {featured ? labels.unfeature : labels.feature}
      </Button>
    </span>
  );
}

export function VisibilityToggle({ slug, hidden, labels }: { slug: string; hidden: boolean; labels: Labels }) {
  const [pending, start] = useTransition();
  return (
    <Button type="button" size="sm" variant={hidden ? "secondary" : "danger"} className="h-7 px-2.5 text-xs" disabled={pending} onClick={() => start(() => (hidden ? restorePost(slug) : hidePost(slug)).catch(() => undefined))}>
      {hidden ? labels.restore : labels.hide}
    </Button>
  );
}
