import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { BackLink } from "@/components/ops/BackLink";
import { PageHeader } from "@/components/ops/PageHeader";
import { LocationForm } from "@/features/locations/LocationForms";
import { requirePagePermission } from "@/lib/auth/staff";

export const metadata: Metadata = { title: "Add location" };

export default async function NewLocationPage() {
  await requirePagePermission("vehicle.edit");
  const t = await getTranslations("locations");

  return (
    <>
      <BackLink href="/locations" />
      <PageHeader title={t("add")} />
      <section className="card max-w-3xl p-6">
        <LocationForm />
      </section>
    </>
  );
}
