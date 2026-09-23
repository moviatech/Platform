import type { NavItem } from "@/components/ops/nav";

export const financeNav: NavItem[] = [
  { key: "financeBoard", href: "/finance/board", permission: "finance.view" },
  { key: "financeBooks", href: "/finance/books", permission: "finance.view" },
  { key: "financeReports", href: "/finance/reports", permission: "finance.view" },
  { key: "financeClose", href: "/finance/close", permission: "finance.view" },
];
