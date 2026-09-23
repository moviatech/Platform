import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import { BackLink } from "@/components/ops/BackLink";
import { PageHeader } from "@/components/ops/PageHeader";
import { ClassVideoForm } from "@/features/fleet/ClassVideoForm";
import { showcaseSlotsFor } from "@/features/fleet/photo-slots";
import { listClassPhotos } from "@/features/fleet/photos";
import { PhotoSlots } from "@/features/fleet/PhotoSlots";
import { requireHqPage } from "@/lib/auth/staff";
import { createAdminClient } from "@/lib/supabase/admin";

export const metadata: Metadata = { title: "Class photos" };

type ClassRow = { id: string; slug: string; model: string; name: string; name_zh: string | null; video_url: string | null };

export default async function ClassLibraryPage() {
  await requireHqPage("vehicle.edit");
  const [t, locale, { data }] = await Promise.all([getTranslations("fleet"), getLocale(), createAdminClient().from("vehicle_classes").select("id, slug, model, name, name_zh, video_url").order("sort_order")]);
  const classes = (data ?? []) as ClassRow[];
  const photos = await listClassPhotos(classes);

  return (
    <>
      <BackLink href="/fleet" />
      <PageHeader title={t("library.title")} />
      <div className="flex flex-col gap-5">
        {classes.map((item) => (
          <section key={item.id} className="card flex flex-col gap-5 p-6">
            <PhotoSlots owner={{ kind: "class", id: item.id }} slots={showcaseSlotsFor(item)} photos={photos[item.id] ?? []} editable title={locale === "zh" ? (item.name_zh ?? item.name) : item.name} />
            <ClassVideoForm classId={item.id} videoUrl={item.video_url} />
          </section>
        ))}
      </div>
    </>
  );
}
