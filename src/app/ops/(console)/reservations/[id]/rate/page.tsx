import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/ops/PageHeader";
import { RateForm } from "@/features/handover/RateForm";
import { getReservation } from "@/features/reservations/queries";
import { requirePagePermission } from "@/lib/auth/staff";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Rate" };

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ stage?: string }> };

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function RatePage({ params, searchParams }: Props) {
  const session = await requirePagePermission("vehicle.inspect");
  const [{ id }, { stage }] = await Promise.all([params, searchParams]);
  if (!uuid.test(id) || (stage !== "pickup" && stage !== "return")) notFound();
  const reservation = await getReservation(id);
  if (!reservation) notFound();

  const kind = stage === "pickup" ? "PICKUP" : "RETURN";
  const supabase = await createClient();
  const [t, tr, { data: existing }] = await Promise.all([
    getTranslations("handover.rating"),
    getTranslations("ratings"),
    supabase.from("ratings").select("score, comment").eq("reservation_id", id).eq("kind", kind).eq("staff_user_id", session.userId).maybeSingle(),
  ]);

  return (
    <div className="mx-auto max-w-lg">
      <PageHeader eyebrow={reservation.number} title={t(stage)} lead={reservation.customer?.full_name ?? undefined} />
      <section className="card p-6 sm:p-8">
        <p className="mb-6 text-[13px] text-charcoal">
          {tr("staff")} · {session.displayName}
        </p>
        <RateForm reservationId={id} stage={stage} defaultScore={existing?.score ?? null} defaultComment={existing?.comment ?? null} />
      </section>
    </div>
  );
}
