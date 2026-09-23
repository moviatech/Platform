"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { getStaffSession } from "@/lib/auth/staff";
import { createAdminClient } from "@/lib/supabase/admin";
import { maxFeatured } from "./queries";

const slugInput = z.string().regex(/^[a-z0-9-]{1,120}$/);

type Patch = { featured?: boolean; featured_at?: string | null; hidden?: boolean };

async function apply(rawSlug: string, action: string, patch: Patch) {
  const session = await getStaffSession();
  const parsed = slugInput.safeParse(rawSlug);
  if (!parsed.success) return;
  const slug = parsed.data;
  const supabase = createAdminClient();
  if (patch.featured) {
    const { count } = await supabase.from("blog_posts").select("slug", { count: "exact", head: true }).eq("featured", true).eq("hidden", false).neq("slug", slug);
    if ((count ?? 0) >= maxFeatured) return;
  }
  const { error } = await supabase.from("blog_posts").update(patch).eq("slug", slug);
  if (error) return;
  await audit({
    actorUserId: session.userId,
    actorType: "STAFF",
    action,
    entityType: "blog_post",
    entityId: slug,
    metadata: { by: session.displayName },
  });
  revalidatePath("/ops/blog", "layout");
}

export async function setFeatured(slug: string) {
  await apply(slug, "blog.featured", { featured: true, featured_at: new Date().toISOString() });
}

export async function clearFeatured(slug: string) {
  await apply(slug, "blog.unfeatured", { featured: false, featured_at: null });
}

export async function hidePost(slug: string) {
  await apply(slug, "blog.hidden", { hidden: true, featured: false, featured_at: null });
}

export async function restorePost(slug: string) {
  await apply(slug, "blog.restored", { hidden: false });
}
