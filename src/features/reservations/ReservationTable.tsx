import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/Badge";
import { formatDateTime, formatMoney } from "@/lib/utils/format";
import { statusTone, type ReservationListItem } from "./types";

export async function ReservationTable({ reservations, backTo }: { reservations: ReservationListItem[]; backTo?: string }) {
  const t = await getTranslations("reservations");
  const common = await getTranslations("common");
  const locale = await getLocale();

  if (reservations.length === 0) {
    return <div className="card px-6 py-14 text-center text-sm text-muted">{common("empty")}</div>;
  }

  const grid = "lg:grid-cols-[7rem_minmax(0,1.2fr)_minmax(0,1.1fr)_minmax(0,1.5fr)_5rem_6rem_7.5rem]";

  return (
    <div className="card overflow-hidden">
      <div className={`hidden gap-4 border-b border-ink/[0.07] bg-pearl/60 px-5 py-2.5 text-[11px] font-medium tracking-[0.12em] text-muted uppercase lg:grid ${grid}`}>
        <span>{t("columns.number")}</span>
        <span>{t("columns.customer")}</span>
        <span>{t("columns.vehicle")}</span>
        <span>{t("columns.period")}</span>
        <span>{t("columns.days")}</span>
        <span className="text-right">{t("columns.total")}</span>
        <span className="text-right">{t("columns.status")}</span>
      </div>
      <ul className="divide-y divide-ink/[0.06]">
        {reservations.map((item) => (
          <li key={item.id}>
            <Link href={`/reservations/${item.id}${backTo ? `?back=${encodeURIComponent(backTo)}` : ""}`} className={`grid grid-cols-2 gap-x-4 gap-y-1 px-5 py-3.5 text-sm transition-colors hover:bg-gold/[0.04] lg:items-center ${grid}`}>
              <span className="font-semibold tracking-wide">{item.number}</span>
              <span className="truncate text-right lg:text-left">{item.customer?.full_name ?? "—"}</span>
              <span className="truncate text-[13px] text-charcoal">
                {item.vehicle?.fleet_number ?? "—"}
                <span className="text-muted"> · {locale === "zh" ? (item.vehicle_class?.name_zh ?? item.vehicle_class?.name) : item.vehicle_class?.name}</span>
              </span>
              <span className="col-span-2 truncate text-[13px] text-charcoal lg:col-span-1">
                {formatDateTime(item.pickup_at, locale)} → {formatDateTime(item.return_at, locale)}
              </span>
              <span className="hidden text-[13px] tabular-nums text-muted lg:block">{item.rental_days}</span>
              <span className="tabular-nums lg:text-right">{formatMoney(item.total_cents)}</span>
              <span className="text-right">
                <Badge tone={statusTone[item.status]}>{t(`status.${item.status}`)}</Badge>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
