import type { NavItem } from "@/components/ops/nav";

export const marketingNav: NavItem[] = [
  { key: "marketingOverview", href: "/marketing/overview", permission: "marketing.view" },
  { key: "blog", href: "/marketing/blog", permission: "blog.manage" },
  { key: "traffic", href: "/marketing/traffic", permission: "marketing.view" },
  { key: "search", href: "/marketing/search", permission: "marketing.view" },
  { key: "insights", href: "/marketing/insights", permission: "marketing.view" },
];
