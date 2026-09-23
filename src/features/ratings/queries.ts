import "server-only";
import { createClient } from "@/lib/supabase/server";
import { lowScoreMax, type Rating, type RatingKind } from "./types";

export type RatingsSummary = { total: number; average: number | null; low: number; nps: number | null; responses: number };

export type StaffRatingRow = { userId: string; displayName: string; count: number; average: number; low: number; kinds: Partial<Record<RatingKind, number>> };

export type RecentRating = Rating & { staffName: string | null; customerName: string | null };

export type SurveyReason = { id: string; score: number; reason: string | null; reservationId: string; reservationNumber: string | null; completedAt: string | null };

type Row = { kind: RatingKind; score: number; staff_user_id: string | null };

function one(value: unknown) {
  return (Array.isArray(value) ? value[0] : value) as Record<string, string | null> | null;
}

function mean(scores: number[]) {
  return scores.length ? scores.reduce((sum, score) => sum + score, 0) / scores.length : null;
}

export async function getRatingsOverview(): Promise<{ summary: RatingsSummary; staff: StaffRatingRow[] }> {
  const supabase = await createClient();
  const [{ data: ratings }, { data: staff }, { data: surveys }] = await Promise.all([
    supabase.from("ratings").select("kind, score, staff_user_id").range(0, 9999),
    supabase.from("staff_members").select("user_id, display_name").eq("active", true),
    supabase.from("trip_surveys").select("recommend_score").not("completed_at", "is", null).not("recommend_score", "is", null),
  ]);
  const rows = (ratings ?? []) as Row[];
  const scores = rows.map((row) => row.score);
  const responses = (surveys ?? []).map((row) => Number(row.recommend_score));
  const promoters = responses.filter((score) => score >= 9).length;
  const detractors = responses.filter((score) => score <= 6).length;
  const summary: RatingsSummary = {
    total: rows.length,
    average: mean(scores),
    low: scores.filter((score) => score <= lowScoreMax).length,
    nps: responses.length ? Math.round(((promoters - detractors) / responses.length) * 100) : null,
    responses: responses.length,
  };
  const staffRows = (staff ?? [])
    .map((member) => {
      const own = rows.filter((row) => row.staff_user_id === member.user_id);
      const kinds: Partial<Record<RatingKind, number>> = {};
      for (const kind of ["PICKUP", "RETURN", "CONVERSATION"] as const) {
        const value = mean(own.filter((row) => row.kind === kind).map((row) => row.score));
        if (value !== null) kinds[kind] = value;
      }
      return {
        userId: member.user_id as string,
        displayName: member.display_name as string,
        count: own.length,
        average: mean(own.map((row) => row.score)) ?? 0,
        low: own.filter((row) => row.score <= lowScoreMax).length,
        kinds,
      };
    })
    .filter((row) => row.count > 0)
    .sort((a, b) => b.count - a.count);
  return { summary, staff: staffRows };
}

export async function listRecentRatings(limit = 50): Promise<RecentRating[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("ratings")
    .select("*, staff:staff_members!ratings_staff_user_id_fkey(display_name), customer:customers!ratings_customer_id_fkey(full_name)")
    .order("created_at", { ascending: false })
    .limit(limit);
  return (data ?? []).map(({ staff, customer, ...rating }) => ({
    ...(rating as Rating),
    staffName: one(staff)?.display_name ?? null,
    customerName: one(customer)?.full_name ?? null,
  }));
}

export async function listSurveyReasons(limit = 20): Promise<SurveyReason[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("trip_surveys")
    .select("id, recommend_score, recommend_reason, reservation_id, completed_at, reservation:reservations!trip_surveys_reservation_id_fkey(number)")
    .not("recommend_score", "is", null)
    .order("completed_at", { ascending: false, nullsFirst: false })
    .limit(limit);
  return (data ?? []).map((row) => ({
    id: row.id as string,
    score: Number(row.recommend_score),
    reason: (row.recommend_reason as string | null) ?? null,
    reservationId: row.reservation_id as string,
    reservationNumber: one(row.reservation)?.number ?? null,
    completedAt: (row.completed_at as string | null) ?? null,
  }));
}
