import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/Badge";
import { cn } from "@/lib/utils/cn";
import { formatDateTime } from "@/lib/utils/format";
import { loadFreshness } from "./views";

const groups = {
  board: [
    ["board", "/finance/board"],
    ["setup", "/finance/board/setup"],
  ],
  reports: [
    ["vouchers", "/finance/reports"],
    ["trial", "/finance/reports/trial"],
    ["checks", "/finance/reports/checks"],
  ],
  close: [
    ["pending", "/finance/close"],
    ["months", "/finance/close/months"],
  ],
} as const;

type Group = keyof typeof groups;

export async function LedgerStatus() {
  const [t, { book, lastRun }] = await Promise.all([getTranslations("finance.ledger"), loadFreshness()]);
  return (
    <span className="flex items-center gap-2 text-[12px] text-muted">
      <Badge tone={book === "live" ? "success" : "warning"}>{t(`book.${book}`)}</Badge>
      {lastRun ? t("asOf", { time: formatDateTime(lastRun) }) : t("never")}
    </span>
  );
}

export async function LedgerTabs<G extends Group>({ group, current }: { group: G; current: (typeof groups)[G][number][0] }) {
  const t = await getTranslations("finance.ledger.tabs");
  return (
    <nav className="mb-5 flex flex-wrap gap-2">
      {groups[group].map(([key, href]) => (
        <Link key={key} href={href} aria-current={key === current ? "page" : undefined} className={cn("rounded-pill px-3.5 py-1.5 text-[13px] hairline hover:border-ink/25", key === current && "bg-ink text-white")}>
          {t(key)}
        </Link>
      ))}
    </nav>
  );
}
