import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/ops/PageHeader";
import { listClassOptions, listLocationOptions } from "@/features/fleet/queries";
import { VehicleForm, type VehiclePreset } from "@/features/fleet/VehicleForm";
import { teslaReady } from "@/features/tesla/service";
import { colorName, decodeVin } from "@/features/tesla/vin";
import { requirePagePermission } from "@/lib/auth/staff";
import { allowsLocation } from "@/lib/auth/scope";
import { createAdminClient } from "@/lib/supabase/admin";
import { vehicleProfile } from "@/lib/tesla/client";

export const metadata: Metadata = { title: "Add vehicle" };

type Props = { searchParams: Promise<{ vin?: string | string[] }> };

export default async function NewVehiclePage({ searchParams }: Props) {
  const session = await requirePagePermission("vehicle.edit");
  const { vin } = await searchParams;
  const decoded = session.locationIds === null ? decodeVin(Array.isArray(vin) ? vin[0] : vin) : null;
  if (decoded) {
    const { data: existing } = await createAdminClient().from("vehicles").select("id").eq("vin", decoded.vin).maybeSingle();
    if (existing) redirect(`/fleet/${existing.id}`);
  }
  const t = await getTranslations("fleet");
  const common = await getTranslations("common");
  const [classes, allLocations] = await Promise.all([listClassOptions(), listLocationOptions()]);
  const locations = allLocations.filter((location) => allowsLocation(session, location.id));
  let preset: VehiclePreset | undefined;
  if (decoded) {
    const tesla = await teslaReady();
    const profile = tesla ? await vehicleProfile(decoded.vin, { timeout: 6000 }).catch(() => null) : null;
    preset = {
      vin: decoded.vin,
      fleetNumber: decoded.fleetNumber,
      year: decoded.year,
      classId: classes.find((item) => item.active && item.model === decoded.model)?.id ?? null,
      odometer: profile?.odometer ?? null,
      battery: profile?.battery ?? null,
      color: colorName(profile?.color),
      tesla,
    };
  }

  return (
    <>
      <Link href="/fleet" className="mb-4 inline-block text-[13px] text-muted hover:text-ink">
        ← {common("back")}
      </Link>
      <PageHeader title={t("add")} />
      <section className="card max-w-3xl p-6">
        <VehicleForm classes={classes} locations={locations} editable preset={preset} />
      </section>
    </>
  );
}
