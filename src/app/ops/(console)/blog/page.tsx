import { redirect } from "next/navigation";
import { requirePagePermission } from "@/lib/auth/staff";

export default async function LegacyBlogPage() {
  await requirePagePermission("blog.manage");
  redirect("/marketing/blog");
}
