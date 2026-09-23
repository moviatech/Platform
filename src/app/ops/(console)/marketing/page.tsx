import { redirect } from "next/navigation";
import { can, getStaffSession, requirePagePermission } from "@/lib/auth/staff";

export default async function MarketingPage() {
  if (can(await getStaffSession(), "marketing.view")) redirect("/marketing/overview");
  await requirePagePermission("blog.manage");
  redirect("/marketing/blog");
}
