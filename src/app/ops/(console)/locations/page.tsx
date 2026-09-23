import type { Metadata } from "next";
import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/Badge";
import { ButtonLink } from "@/components/ui/Button";
import { PageHeader } from "@/components/ops/PageHeader";
import { DeleteLocationButton } from "@/features/locations/LocationForms";
import { listLocations } from "@/features/locations/queries";
import { can, requirePagePermission } from "@/lib/auth/staff";
import { cn } from "@/lib/utils/cn";

export const metadata: Metadata = { title: "Locations" };

const grid = "md:grid-cols-[minmax(0,1.3fr)_minmax(0,2fr)_5rem_6rem_9rem]";

export default async function LocationsPage() {
  const session = await requirePagePermission("vehicle.view");
  const [t, locale, locations] = await Promise.all([getTranslations("locations"), getLocale(), listLocations()]);
  const editable = can(session, "vehicle.edit");

  return (
    <>
      <PageHeader
        title={t("title")}
        actions={
          editable ? (
            <ButtonLink href="/locations/new" size="sm">
              {t("add")}
            </ButtonLink>
          ) : undefined
        }
      />
      <div className="card overflow-hidden">
        <div className={cn("hidden gap-4 border-b border-ink/[0.07] bg-pearl/60 px-5 py-2.5 text-[11px] font-medium tracking-[0.12em] text-muted uppercase md:grid", grid)}>
          <span>{t("columns.name")}</span>
          <span>{t("columns.address")}</span>
          <span>{t("columns.vehicles")}</span>
          <span>{t("columns.status")}</span>
          <span />
        </div>
        <ul className="divide-y divide-ink/[0.06]">
          {locations.map((location) => (
            <li key={location.id} className={cn("grid gap-x-4 gap-y-2 px-5 py-4 text-sm md:items-center", grid, !location.active && "opacity-60")}>
              <span className="min-w-0">
                <span className="block truncate font-medium">{locale === "zh" ? (location.name_zh ?? location.name) : location.name}</span>
                {locale === "zh" && location.name_zh && <span className="block truncate text-[12px] text-muted">{location.name}</span>}
              </span>
              <span className="truncate text-[13px] text-charcoal">{location.address || "—"}</span>
              <span className="tabular-nums text-charcoal">{location.vehicles}</span>
              <span>
                <Badge tone={location.active ? "success" : "neutral"}>{location.active ? t("active") : t("inactive")}</Badge>
              </span>
              <span className="flex items-center gap-2 md:justify-end">
                {editable && (
                  <>
                    <Link href={`/locations/${location.id}`} className="text-[13px] font-medium text-charcoal hover:text-ink">
                      {t("edit")}
                    </Link>
                    <DeleteLocationButton id={location.id} disabled={location.vehicles > 0 || location.reservations > 0 || locations.length <= 1} />
                  </>
                )}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}
