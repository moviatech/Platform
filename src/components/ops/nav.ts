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
  { items: [{ key: "overview", href: "/" }] },
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
      { key: "blog", href: "/blog" },
    ],
  },
  {
    key: "investorsGroup",
    items: [{ key: "investors", href: "/investors", permission: "investor.view" }],
  },
  {
    key: "revenue",
    items: [
      { key: "finance", href: "/finance", permission: "finance.view" },
      { key: "approvals", href: "/approvals", permission: "finance.approve" },
      { key: "pricing", href: "/pricing", permission: "pricing.view" },
    ],
  },
  {
    key: "system",
    items: [
      { key: "ratings", href: "/ratings", permission: "ratings.view" },
      { key: "staff", href: "/staff", permission: "staff.view" },
      { key: "audit", permission: "audit.view" },
    ],
  },
];
