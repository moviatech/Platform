import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { cn } from "@/lib/utils/cn";
import { formatDateTime } from "@/lib/utils/format";
import { renderParams, type Notification } from "./center";

type Props = { items: Notification[]; compact?: boolean; base?: string };

export async function NotificationList({ items, compact = false, base = "/inbox/notifications" }: Props) {
  const [t, locale] = await Promise.all([getTranslations("notifications"), getLocale()]);
  if (items.length === 0) return <p className="px-1 py-3 text-[13px] text-muted">{t("empty")}</p>;
  return (
    <ul className={cn("divide-y divide-ink/[0.06]", !compact && "card")}>
      {items.map((item) => {
        const params = renderParams(item.params, locale);
        const key = item.kind.replace(/\./g, "_");
        const label = t.has(`kinds.${key}`) ? t(`kinds.${key}`, params) : item.kind;
        return (
          <li key={item.id}>
            <Link href={`${base}/${item.id}`} className={cn("flex items-start gap-3 px-4 py-3 hover:bg-pearl/60", compact && "px-1 py-2.5")}>
              <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", item.read_at ? "bg-transparent" : "bg-gold")} />
              <span className="min-w-0 flex-1">
                <span className={cn("block text-[13px]", item.read_at ? "text-charcoal" : "font-semibold text-ink")}>{label}</span>
                <span className="block text-[11px] text-muted">{formatDateTime(item.created_at)}</span>
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
