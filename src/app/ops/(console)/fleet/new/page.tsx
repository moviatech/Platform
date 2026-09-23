import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/ops/PageHeader";
import { listClassOptions, listLocationOptions } from "@/features/fleet/queries";
import { VehicleForm } from "@/features/fleet/VehicleForm";
import { requirePagePermission } from "@/lib/auth/staff";
import { allowsLocation } from "@/lib/auth/scope";

export const metadata: Metadata = { title: "Add vehicle" };

export default async function NewVehiclePage() {
  const session = await requirePagePermission("vehicle.edit");
  const t = await getTranslations("fleet");
  const common = await getTranslations("common");
  const [classes, allLocations] = await Promise.all([listClassOptions(), listLocationOptions()]);
  const locations = allLocations.filter((location) => allowsLocation(session, location.id));

  return (
    <>
      <Link href="/fleet" className="mb-4 inline-block text-[13px] text-muted hover:text-ink">
        ← {common("back")}
      </Link>
      <PageHeader title={t("add")} />
      <section className="card max-w-3xl p-6">
        <VehicleForm classes={classes} locations={locations} editable />
      </section>
    </>
  );
}
