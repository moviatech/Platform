import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/ops/PageHeader";
import { listClassOptions } from "@/features/fleet/queries";
import { VehicleForm } from "@/features/fleet/VehicleForm";
import { requirePagePermission } from "@/lib/auth/staff";

export const metadata: Metadata = { title: "Add vehicle" };

export default async function NewVehiclePage() {
  await requirePagePermission("vehicle.edit");
  const t = await getTranslations("fleet");
  const common = await getTranslations("common");
  const classes = await listClassOptions();

  return (
    <>
      <Link href="/fleet" className="mb-4 inline-block text-[13px] text-muted hover:text-ink">
        ← {common("back")}
      </Link>
      <PageHeader title={t("add")} />
      <section className="card max-w-3xl p-6">
        <VehicleForm classes={classes} editable />
      </section>
    </>
  );
}
