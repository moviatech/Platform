import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { Logo } from "@/components/ui/Logo";
import { listTouchpoints } from "@/features/ratings/service";
import { SurveyForm } from "@/features/ratings/SurveyForm";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatDay } from "@/lib/utils/format";

export const metadata: Metadata = { title: "Survey" };

type Props = { params: Promise<{ token: string }> };

export default async function SurveyPage({ params }: Props) {
  const { token } = await params;
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) notFound();
  const supabase = createAdminClient();
  const { data: survey } = await supabase
    .from("trip_surveys")
    .select("id, reservation_id, completed_at, recommend_score, recommend_reason, reservation:reservations(number, pickup_at, return_at, vehicle_class:vehicle_classes(name, name_zh))")
    .eq("token", token)
    .maybeSingle();
  if (!survey) notFound();
  const [t, locale, touchpoints] = await Promise.all([getTranslations("survey"), getLocale(), listTouchpoints(survey.reservation_id)]);
  const reservation = Array.isArray(survey.reservation) ? survey.reservation[0] : survey.reservation;
  const vehicleClass = Array.isArray(reservation?.vehicle_class) ? reservation?.vehicle_class[0] : reservation?.vehicle_class;
  const vehicle = (locale === "zh" ? (vehicleClass?.name_zh ?? vehicleClass?.name) : vehicleClass?.name) ?? "";

  return (
    <div className="min-h-dvh bg-[#fafaf8] px-4 py-10">
      <div className="mx-auto w-full max-w-xl">
        <div className="mb-6 flex justify-center">
          <Logo />
        </div>
        <div className="card p-6 sm:p-8">
          <h1 className="text-[1.6rem] leading-tight font-medium tracking-tight">{t("title")}</h1>
          {reservation && (
            <p className="mt-1.5 text-[13px] text-muted">
              {reservation.number} · {vehicle} · {formatDay(reservation.pickup_at, locale)} → {formatDay(reservation.return_at, locale)}
            </p>
          )}
          <div className="mt-6">
            <SurveyForm token={token} touchpoints={touchpoints} completed={survey.completed_at ? { recommend: survey.recommend_score, reason: survey.recommend_reason } : null} />
          </div>
        </div>
      </div>
    </div>
  );
}
