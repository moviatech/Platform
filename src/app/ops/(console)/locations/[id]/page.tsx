import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getLocale } from "next-intl/server";
import { BackLink } from "@/components/ops/BackLink";
import { PageHeader } from "@/components/ops/PageHeader";
import { LocationForm } from "@/features/locations/LocationForms";
import { getLocation } from "@/features/locations/queries";
import { requirePagePermission } from "@/lib/auth/staff";

export const metadata: Metadata = { title: "Location" };

type Props = { params: Promise<{ id: string }> };

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function LocationPage({ params }: Props) {
  await requirePagePermission("vehicle.edit");
  const { id } = await params;
  if (!uuid.test(id)) notFound();
  const [location, locale] = await Promise.all([getLocation(id), getLocale()]);
  if (!location) notFound();

  return (
    <>
      <BackLink href="/locations" />
      <PageHeader title={locale === "zh" ? (location.name_zh ?? location.name) : location.name} />
      <section className="card max-w-3xl p-6">
        <LocationForm location={location} />
      </section>
    </>
  );
}
