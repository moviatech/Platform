"use server";

import { revalidatePath } from "next/cache";
import { slugPattern } from "@/features/blog/blocks";
import { requirePermission } from "@/lib/auth/staff";
import type { SearchLine } from "./analysis";
import { dropCached } from "./cache";
import { googleSettings, googleStatus } from "./google/config";
import { checkArticle } from "./indexing";
import { loadArticleQueries, searchKey } from "./search";
import { trafficKey } from "./traffic";

export async function refreshTraffic() {
  await requirePermission("marketing.view");
  const { property } = googleSettings();
  if (property) await dropCached(trafficKey(property));
  revalidatePath("/ops/marketing/traffic");
}

export async function refreshSearch() {
  await requirePermission("marketing.view");
  const { site } = googleSettings();
  if (site) await dropCached(searchKey(site));
  revalidatePath("/ops/marketing/search");
}

export async function articleQueries(slug: string): Promise<SearchLine[] | null> {
  await requirePermission("marketing.view");
  if (typeof slug !== "string" || !slugPattern.test(slug) || slug.length > 120 || !googleStatus().search) return null;
  try {
    return (await loadArticleQueries(slug)).value;
  } catch {
    return null;
  }
}

export async function checkIndexing(slug: string): Promise<{ ok: boolean }> {
  await requirePermission("marketing.view");
  if (typeof slug !== "string" || !slugPattern.test(slug) || slug.length > 120) return { ok: false };
  const done = await checkArticle(slug);
  revalidatePath("/ops/marketing/search");
  return { ok: done > 0 };
}
