import { financeNav } from "@/features/finance/nav";
import { marketingNav } from "@/features/marketing/nav";
import type { Permission } from "@/lib/auth/permissions";

export type NavItem = {
  key: string;
  href?: string;
  permission?: Permission;
};

export type NavGroup = {
  key?: string;
  items: NavItem[];
};

export const navGroups: NavGroup[] = [
  { items: [{ key: "overview", href: "/", permission: "overview.view" }] },
  {
    key: "operations",
    items: [
      { key: "reservations", href: "/reservations", permission: "reservation.view" },
      { key: "fleet", href: "/fleet", permission: "vehicle.view" },
      { key: "locations", href: "/locations", permission: "vehicle.view" },
      { key: "prep", href: "/prep", permission: "prep.view" },
    ],
  },
  {
    key: "customersGroup",
    items: [
      { key: "customers", href: "/customers", permission: "customer.view_basic" },
      { key: "inbox", href: "/inbox", permission: "inbox.view" },
    ],
  },
  { key: "marketingGroup", items: marketingNav },
  {
    key: "investorsGroup",
    items: [{ key: "investors", href: "/investors", permission: "investor.view" }],
  },
  { key: "financeGroup", items: financeNav },
  {
    key: "revenue",
    items: [
      { key: "approvals", href: "/approvals", permission: "finance.approve" },
      { key: "pricing", href: "/pricing", permission: "pricing.view" },
      { key: "coupons", href: "/coupons", permission: "pricing.view" },
    ],
  },
  {
    key: "system",
    items: [
      { key: "ratings", href: "/ratings", permission: "ratings.view" },
      { key: "staff", href: "/staff", permission: "staff.view" },
      { key: "audit", href: "/audit", permission: "audit.view" },
    ],
  },
];

export function landingHref(allowed: (permission: Permission) => boolean) {
  for (const group of navGroups) for (const item of group.items) if (item.href && item.permission && allowed(item.permission)) return item.href;
  return "/forbidden";
}
